import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { ToolRing } from "@/lib/agent/types";

/**
 * Audit + undo for ring 2 / ring 3 agent writes (Phase 3).
 *
 * Every write tool wraps its mutation in `recordAction`. For ring 2
 * (write_mashi) the tool also supplies an `undoPayload` describing the
 * reverse operation, plus a `summary` for the in-chat undo strip.
 * Tokens expire 30s after creation; the in-chat strip POSTs to
 * /api/agent/undo with the action id, and `applyUndo` resolves the
 * reverse operation atomically (set undone_at + run the inverse write).
 *
 * Shape of `undo_payload` is tool-specific. The `applyReverseOperation`
 * dispatcher below knows how to undo each `kind`; adding a new ring-2
 * tool means registering a new reverse-op kind in REVERSE_OPS.
 */

const UNDO_WINDOW_MS = 30_000;

type Supa = SupabaseClient;

export type ReverseOp =
  // Patch back the prior values on an item.
  | {
      kind: "update_item_fields";
      id: string;
      prior: Record<string, unknown>;
    }
  // Delete an item we created (rows: new s2d_items / new decision_log).
  | {
      kind: "delete_item";
      id: string;
    }
  // Restore needs_review flag and (optionally) status.
  | {
      kind: "restore_review";
      id: string;
      prior_needs_review: boolean;
      prior_status?: string;
    }
  // Restore prior decision_log JSONB (decision tools).
  | {
      kind: "restore_decision_log";
      id: string;
      prior_decision_log: unknown;
      prior_decision_note: string | null;
      prior_decision_at: string | null;
    }
  // Delete a watch_check_ins row we just inserted.
  | {
      kind: "delete_watch_check_in";
      id: string;
    }
  // Restore primary item + un-delete duplicates after a merge.
  | {
      kind: "restore_merge";
      primary_id: string;
      prior_primary_title: string;
      prior_primary_description: string | null;
      duplicate_ids: string[];
      prior_duplicate_statuses: Record<string, string>;
    };

export interface RecordActionInput {
  userId: string;
  threadId?: string | null;
  toolName: string;
  ring: ToolRing;
  args: unknown;
  result: unknown;
  ok: boolean;
  /** Undoable summary line ("Snoozed MASH-1408 until 2026-06-01") and
   * the reverse op payload. Both must be present for an undo strip to
   * surface; ring 3 (write_world) calls always omit both. */
  undoPayload?: ReverseOp | null;
  undoSummary?: string | null;
  supabase?: Supa;
}

export interface RecordedAction {
  id: string;
  undoExpiresAt: string | null;
  undoSummary: string | null;
}

/**
 * Insert one audit row. Returns the action id so the loop can emit a
 * delta carrying it; the in-chat undo strip POSTs back with the id to
 * apply the reverse op.
 */
export async function recordAction(
  input: RecordActionInput
): Promise<RecordedAction> {
  const supabase = input.supabase ?? createSupabaseServiceClient();
  const undoable =
    input.ring === "write_mashi" &&
    input.ok &&
    input.undoPayload != null &&
    input.undoSummary != null;
  const expiresAt = undoable
    ? new Date(Date.now() + UNDO_WINDOW_MS).toISOString()
    : null;

  const { data, error } = await supabase
    .from("agent_actions")
    .insert({
      user_id: input.userId,
      thread_id: input.threadId ?? null,
      tool_name: input.toolName,
      ring: input.ring,
      args: input.args as object,
      result: (input.result ?? null) as object | null,
      ok: input.ok,
      undo_payload: undoable
        ? ({
            op: input.undoPayload,
            summary: input.undoSummary,
          } as object)
        : null,
      undo_expires_at: expiresAt,
    })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("recordAction insert failed");
  return {
    id: data.id as string,
    undoExpiresAt: expiresAt,
    undoSummary: undoable ? (input.undoSummary ?? null) : null,
  };
}

interface UndoResult {
  ok: boolean;
  summary?: string;
  error?: string;
}

/**
 * Resolve an undo request. Enforces the 30s expiry server-side and
 * marks the row undone before applying the reverse op so a slow
 * inverse write can't be double-applied by a retry.
 */
export async function applyUndo(opts: {
  userId: string;
  actionId: string;
  supabase?: Supa;
}): Promise<UndoResult> {
  const supabase = opts.supabase ?? createSupabaseServiceClient();
  const { data: row, error } = await supabase
    .from("agent_actions")
    .select(
      "id, user_id, undo_payload, undo_expires_at, undone_at, ok, ring"
    )
    .eq("user_id", opts.userId)
    .eq("id", opts.actionId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!row) return { ok: false, error: "Action not found." };
  if (row.undone_at)
    return { ok: false, error: "This action was already undone." };
  if (!row.undo_payload)
    return { ok: false, error: "This action isn't reversible." };
  if (!row.undo_expires_at) {
    return { ok: false, error: "This action can no longer be undone." };
  }
  if (new Date(row.undo_expires_at).getTime() < Date.now()) {
    return {
      ok: false,
      error: "This action can no longer be undone, too much time has passed.",
    };
  }

  // Stamp undone_at first so concurrent retries see it as already-done.
  const stamp = await supabase
    .from("agent_actions")
    .update({ undone_at: new Date().toISOString() })
    .eq("user_id", opts.userId)
    .eq("id", opts.actionId)
    .is("undone_at", null)
    .select("id")
    .maybeSingle();
  if (stamp.error)
    return { ok: false, error: stamp.error.message };
  if (!stamp.data)
    return { ok: false, error: "This action was already undone." };

  const payload = row.undo_payload as { op: ReverseOp; summary: string };
  try {
    await applyReverseOp(payload.op, opts.userId, supabase);
    return { ok: true, summary: payload.summary };
  } catch (err) {
    // Roll the undone_at stamp back so the user can retry. Best-effort.
    await supabase
      .from("agent_actions")
      .update({ undone_at: null })
      .eq("user_id", opts.userId)
      .eq("id", opts.actionId);
    const message = err instanceof Error ? err.message : "undo failed";
    return { ok: false, error: message };
  }
}

async function applyReverseOp(
  op: ReverseOp,
  userId: string,
  supabase: Supa
): Promise<void> {
  switch (op.kind) {
    case "update_item_fields": {
      const { error } = await supabase
        .from("s2d_items")
        .update(op.prior)
        .eq("user_id", userId)
        .eq("id", op.id);
      if (error) throw error;
      return;
    }
    case "delete_item": {
      const { error } = await supabase
        .from("s2d_items")
        .delete()
        .eq("user_id", userId)
        .eq("id", op.id);
      if (error) throw error;
      return;
    }
    case "restore_review": {
      const patch: Record<string, unknown> = {
        needs_review: op.prior_needs_review,
      };
      if (op.prior_status) patch.status = op.prior_status;
      const { error } = await supabase
        .from("s2d_items")
        .update(patch)
        .eq("user_id", userId)
        .eq("id", op.id);
      if (error) throw error;
      return;
    }
    case "restore_decision_log": {
      const { error } = await supabase
        .from("s2d_items")
        .update({
          decision_log: op.prior_decision_log,
          decision_note: op.prior_decision_note,
          decision_at: op.prior_decision_at,
        })
        .eq("user_id", userId)
        .eq("id", op.id);
      if (error) throw error;
      return;
    }
    case "delete_watch_check_in": {
      const { error } = await supabase
        .from("watch_check_ins")
        .delete()
        .eq("user_id", userId)
        .eq("id", op.id);
      if (error) throw error;
      return;
    }
    case "restore_merge": {
      const primaryUpdate = await supabase
        .from("s2d_items")
        .update({
          title: op.prior_primary_title,
          description: op.prior_primary_description,
        })
        .eq("user_id", userId)
        .eq("id", op.primary_id);
      if (primaryUpdate.error) throw primaryUpdate.error;
      for (const id of op.duplicate_ids) {
        const priorStatus = op.prior_duplicate_statuses[id];
        if (!priorStatus) continue;
        const dupUpdate = await supabase
          .from("s2d_items")
          .update({ status: priorStatus, resolved_via: null })
          .eq("user_id", userId)
          .eq("id", id);
        if (dupUpdate.error) throw dupUpdate.error;
      }
      return;
    }
    default: {
      const exhaustive: never = op;
      throw new Error(`Unknown reverse op: ${JSON.stringify(exhaustive)}`);
    }
  }
}
