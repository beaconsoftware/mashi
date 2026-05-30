import type { SupabaseClient } from "@supabase/supabase-js";
import { abortableSleep } from "@/lib/agent/retry";

/**
 * Per-call approval gate for ring-3 (write_world) agent tools.
 *
 * The loop writes one row per pending ring-3 call into `agent_approvals`,
 * emits an `approval-needed` SSE delta, then polls the row until status
 * flips or the row expires. The user's Approve / Edit / Cancel click
 * lands on a separate HTTP request that updates the same row.
 *
 * Poll cadence is short (every 750ms) so the UX feels live; the row
 * has a 5-minute server-side expiry so a stalled approval doesn't
 * accumulate forever. The streaming route caps maxDuration at 300s.
 */

export type ApprovalDecision = "approve" | "edit" | "cancel";

export type ApprovalOutcome =
  | { kind: "approve"; args: unknown }
  | { kind: "edit"; editedArgs: unknown }
  | { kind: "cancel"; reason?: string }
  | { kind: "expired" };

interface PendingArgs {
  userId: string;
  threadId: string;
  callId: string;
  toolName: string;
  args: unknown;
  supabase: SupabaseClient;
}

export async function createPendingApproval(
  input: PendingArgs
): Promise<{ id: string; expiresAt: string }> {
  const { data, error } = await input.supabase
    .from("agent_approvals")
    .insert({
      user_id: input.userId,
      thread_id: input.threadId,
      call_id: input.callId,
      tool_name: input.toolName,
      args: input.args as object,
    })
    .select("id, expires_at")
    .single();
  if (error || !data) {
    throw error ?? new Error("createPendingApproval failed");
  }
  return { id: data.id as string, expiresAt: data.expires_at as string };
}

interface WaitArgs {
  userId: string;
  threadId: string;
  callId: string;
  supabase: SupabaseClient;
  /** Hard cap on time we'll wait. Defaults to 270s — slightly below the
   * 300s route maxDuration so the loop has time to emit a final delta
   * before Vercel kills the stream. */
  timeoutMs?: number;
  /** Poll interval. Default 750ms. */
  pollMs?: number;
  /** Signal that the client disconnected. Polls bail when aborted. */
  signal?: AbortSignal;
}

export async function awaitApprovalDecision(
  input: WaitArgs
): Promise<ApprovalOutcome> {
  const timeoutMs = input.timeoutMs ?? 270_000;
  const pollMs = input.pollMs ?? 750;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (input.signal?.aborted) {
      return { kind: "cancel", reason: "client aborted" };
    }
    const { data, error } = await input.supabase
      .from("agent_approvals")
      .select("status, edited_args, args, expires_at")
      .eq("user_id", input.userId)
      .eq("thread_id", input.threadId)
      .eq("call_id", input.callId)
      .maybeSingle();
    if (error) {
      // Stop polling on a hard DB error.
      return { kind: "cancel", reason: error.message };
    }
    if (!data) {
      return { kind: "cancel", reason: "approval row missing" };
    }
    if (data.status === "approved") {
      return { kind: "approve", args: data.args };
    }
    if (data.status === "edited") {
      return { kind: "edit", editedArgs: data.edited_args };
    }
    if (data.status === "cancelled") {
      return { kind: "cancel" };
    }
    if (data.status === "expired") {
      return { kind: "expired" };
    }
    if (
      data.expires_at &&
      new Date(data.expires_at).getTime() < Date.now()
    ) {
      await markExpired({
        userId: input.userId,
        threadId: input.threadId,
        callId: input.callId,
        supabase: input.supabase,
      });
      return { kind: "expired" };
    }
    // A5: an abortable sleep so a client disconnect / Stop ends the poll
    // within the abort tick rather than waiting out the full interval.
    await abortableSleep(pollMs, input.signal);
    if (input.signal?.aborted) {
      return { kind: "cancel", reason: "client aborted" };
    }
  }

  await markExpired({
    userId: input.userId,
    threadId: input.threadId,
    callId: input.callId,
    supabase: input.supabase,
  });
  return { kind: "expired" };
}

interface DecisionArgs {
  userId: string;
  threadId: string;
  callId: string;
  decision: ApprovalDecision;
  editedArgs?: unknown;
  supabase: SupabaseClient;
}

/**
 * Apply a user's decision. Returns ok=false if the row is missing,
 * already decided, or expired so the API layer can return a useful
 * 4xx without leaking shape.
 */
export async function recordApprovalDecision(
  input: DecisionArgs
): Promise<{ ok: boolean; error?: string }> {
  const { data: row, error } = await input.supabase
    .from("agent_approvals")
    .select("id, status, expires_at")
    .eq("user_id", input.userId)
    .eq("thread_id", input.threadId)
    .eq("call_id", input.callId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!row) return { ok: false, error: "approval not found" };
  if (row.status !== "pending") {
    return { ok: false, error: `already ${row.status}` };
  }
  if (
    row.expires_at &&
    new Date(row.expires_at).getTime() < Date.now()
  ) {
    await markExpired({
      userId: input.userId,
      threadId: input.threadId,
      callId: input.callId,
      supabase: input.supabase,
    });
    return { ok: false, error: "approval expired" };
  }

  const statusByDecision: Record<ApprovalDecision, string> = {
    approve: "approved",
    edit: "edited",
    cancel: "cancelled",
  };
  const patch: Record<string, unknown> = {
    status: statusByDecision[input.decision],
    decided_at: new Date().toISOString(),
  };
  if (input.decision === "edit") {
    patch.edited_args = (input.editedArgs ?? null) as object | null;
  }

  const { error: upErr } = await input.supabase
    .from("agent_approvals")
    .update(patch)
    .eq("user_id", input.userId)
    .eq("thread_id", input.threadId)
    .eq("call_id", input.callId)
    .eq("status", "pending");
  if (upErr) return { ok: false, error: upErr.message };
  return { ok: true };
}

async function markExpired(opts: {
  userId: string;
  threadId: string;
  callId: string;
  supabase: SupabaseClient;
}): Promise<void> {
  await opts.supabase
    .from("agent_approvals")
    .update({ status: "expired", decided_at: new Date().toISOString() })
    .eq("user_id", opts.userId)
    .eq("thread_id", opts.threadId)
    .eq("call_id", opts.callId)
    .eq("status", "pending");
}
