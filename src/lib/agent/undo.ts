import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { UNDO_WINDOW_MS } from "@/lib/agent/undo-constants";

export { UNDO_WINDOW_MS };

/**
 * Audit + undo plumbing for ring-2 (write_mashi) and ring-3
 * (write_world) tool calls.
 *
 * Every ring-2 write tool builds a tiny `UndoPayload` describing how to
 * reverse the mutation, then calls `recordAction()` to persist the
 * audit row and stamp a 30s `undo_expires_at`. The tool returns the
 * audit row's id back through its result; the agent loop attaches that
 * to the SSE delta so the UI can render an undo strip with the
 * pre-built summary string.
 *
 * Reverse-op design: undo is generic, not per-tool. The supported
 * payload `kind`s express the inverse mutation as a JSONB descriptor —
 * `patch_s2d_item` reapplies a captured prior row state, `delete_row`
 * removes a row that a create_* tool inserted, `insert_row` restores
 * one a soft-delete tool removed, `multi` chains those for compound
 * tools like `merge_items`. New ring-2 tools should reach for these
 * primitives before adding a new `kind`.
 *
 * Ring 3 (Phase 5) records audit rows here too, but with
 * `undo_payload: null` — external sends are explicit-approve, not
 * optimistic, so there's no undo affordance.
 */

export type UndoPayload =
  | {
      /** Reapply a captured snapshot of an s2d_items row's fields. */
      kind: "patch_s2d_item";
      id: string;
      prior: Record<string, unknown>;
    }
  | {
      /** Delete a row a write tool just inserted (e.g. create_item). */
      kind: "delete_row";
      table: "s2d_items" | "watch_check_ins";
      id: string;
    }
  | {
      /** Restore a row a write tool just deleted / soft-deleted. */
      kind: "insert_row";
      table: "s2d_items" | "watch_check_ins";
      row: Record<string, unknown>;
    }
  | {
      /** Patch a sprint_sessions row back to a prior snapshot. */
      kind: "patch_sprint_session";
      id: string;
      prior: Record<string, unknown>;
    }
  | {
      /** Sequenced compound undo. Run ops in order. */
      kind: "multi";
      ops: UndoPayload[];
    };

export interface RecordActionOpts {
  userId: string;
  threadId?: string | null;
  toolName: string;
  ring: "write_mashi" | "write_world";
  args: unknown;
  result?: unknown;
  ok: boolean;
  /** Plain-English one-liner shown in the undo strip / audit UI. */
  summary?: string;
  undoPayload?: UndoPayload | null;
  supabase?: SupabaseClient;
}

export interface AgentActionRow {
  id: string;
  user_id: string;
  thread_id: string | null;
  tool_name: string;
  ring: "write_mashi" | "write_world";
  args: unknown;
  result: unknown;
  ok: boolean;
  undo_payload: UndoPayload | null;
  undo_expires_at: string | null;
  undone_at: string | null;
  created_at: string;
}

/**
 * Insert an `agent_actions` row. Returns the row id, which write tools
 * include in their result so the loop can surface an undo token.
 *
 * The undo expiry is set 30s in the future when an `undoPayload` is
 * supplied; otherwise null (Ring 3, or ring 2 ops that legitimately
 * have no reverse — none today, but the column allows it).
 */
export async function recordAction(opts: RecordActionOpts): Promise<{
  actionId: string;
  expiresAt: string | null;
}> {
  const supabase = opts.supabase ?? createSupabaseServiceClient();
  const expiresAt = opts.undoPayload
    ? new Date(Date.now() + UNDO_WINDOW_MS).toISOString()
    : null;

  const row = {
    user_id: opts.userId,
    thread_id: opts.threadId ?? null,
    tool_name: opts.toolName,
    ring: opts.ring,
    args: opts.args as Record<string, unknown>,
    result:
      opts.result === undefined
        ? null
        : (opts.result as Record<string, unknown>),
    ok: opts.ok,
    undo_payload: (opts.undoPayload ?? null) as Record<string, unknown> | null,
    undo_expires_at: expiresAt,
  };

  const ins = await supabase
    .from("agent_actions")
    .insert(row)
    .select("id")
    .single();
  if (ins.error || !ins.data) {
    throw ins.error ?? new Error("agent_actions insert failed");
  }
  return { actionId: ins.data.id as string, expiresAt };
}

interface ApplyUndoResult {
  ok: boolean;
  reason?: string;
  action?: AgentActionRow;
}

/**
 * Execute an undo. Idempotent: if the action has already been undone,
 * returns `ok=true` with a `reason` flag so the UI can quietly clear
 * its strip. If the action's window has expired, returns ok=false with
 * an "expired" reason — surfaced as a clean error message client-side.
 */
export async function applyUndo(opts: {
  userId: string;
  actionId: string;
  supabase?: SupabaseClient;
}): Promise<ApplyUndoResult> {
  const supabase = opts.supabase ?? createSupabaseServiceClient();

  const found = await supabase
    .from("agent_actions")
    .select("*")
    .eq("user_id", opts.userId)
    .eq("id", opts.actionId)
    .maybeSingle();

  if (found.error) throw found.error;
  if (!found.data) {
    return { ok: false, reason: "not_found" };
  }

  const action = found.data as AgentActionRow;

  if (action.undone_at) {
    return { ok: true, reason: "already_undone", action };
  }
  if (!action.undo_payload) {
    return { ok: false, reason: "irreversible", action };
  }
  if (
    action.undo_expires_at &&
    new Date(action.undo_expires_at).getTime() < Date.now()
  ) {
    return { ok: false, reason: "expired", action };
  }

  await executeUndoPayload(action.undo_payload, opts.userId, supabase);

  const stamp = await supabase
    .from("agent_actions")
    .update({ undone_at: new Date().toISOString() })
    .eq("user_id", opts.userId)
    .eq("id", opts.actionId)
    .select("*")
    .single();

  return {
    ok: true,
    action: (stamp.data as AgentActionRow | null) ?? action,
  };
}

async function executeUndoPayload(
  payload: UndoPayload,
  userId: string,
  supabase: SupabaseClient
): Promise<void> {
  switch (payload.kind) {
    case "patch_s2d_item": {
      const { error } = await supabase
        .from("s2d_items")
        .update(payload.prior)
        .eq("user_id", userId)
        .eq("id", payload.id);
      if (error) throw error;
      return;
    }
    case "delete_row": {
      const { error } = await supabase
        .from(payload.table)
        .delete()
        .eq("user_id", userId)
        .eq("id", payload.id);
      if (error) throw error;
      return;
    }
    case "insert_row": {
      const { error } = await supabase
        .from(payload.table)
        .insert({ ...payload.row, user_id: userId });
      if (error) throw error;
      return;
    }
    case "patch_sprint_session": {
      const { error } = await supabase
        .from("sprint_sessions")
        .update(payload.prior)
        .eq("user_id", userId)
        .eq("id", payload.id);
      if (error) throw error;
      return;
    }
    case "multi": {
      for (const op of payload.ops) {
        await executeUndoPayload(op, userId, supabase);
      }
      return;
    }
  }
}

/**
 * Capture the columns we want to be able to restore on an s2d_items
 * row before a write. The list is intentionally narrow: only fields a
 * ring-2 tool legitimately mutates. Anything outside this list is
 * irrelevant to undo (and we don't want to round-trip server-only
 * columns like `updated_at`).
 */
export const S2D_UNDO_FIELDS = [
  "title",
  "description",
  "status",
  "pathway",
  "priority",
  "company_id",
  "planned_for",
  "snoozed_until",
  "queue_reason",
  "queue_until",
  "outcome",
  "resolved_via",
  "done_at",
  "needs_review",
  "decision_log",
  "decision_note",
  "decision_at",
  "success_statement",
  "enriched_context",
] as const;

export type S2DUndoField = (typeof S2D_UNDO_FIELDS)[number];

/**
 * Build a "patch_s2d_item" payload from a snapshot of an item row,
 * stripped to the subset of restorable fields. Use when capturing
 * pre-mutation state for an update / snooze / complete / etc.
 */
export function snapshotS2DPrior(
  id: string,
  row: Record<string, unknown>
): UndoPayload {
  const prior: Record<string, unknown> = {};
  for (const f of S2D_UNDO_FIELDS) {
    if (f in row) prior[f] = row[f];
  }
  return { kind: "patch_s2d_item", id, prior };
}
