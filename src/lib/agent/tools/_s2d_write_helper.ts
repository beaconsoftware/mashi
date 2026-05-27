import type { ToolContext } from "@/lib/agent/types";
import {
  recordAction,
  snapshotS2DPrior,
  type UndoPayload,
} from "@/lib/agent/undo";

/**
 * Shared scaffolding for s2d_items write tools.
 *
 * Every ring-2 mutation against an s2d_items row follows the same
 * shape: load the prior row, apply a patch, write an `agent_actions`
 * audit row with a `patch_s2d_item` undo payload that re-applies the
 * captured prior state. This helper centralises that flow so each tool
 * file stays small.
 *
 * The returned object includes the agent_actions row id under
 * `_agent_action_id`. The loop reads that field off every ring-2 tool
 * result and emits an `undoable` delta so the UI can render a strip.
 */

export interface PatchS2DOpts {
  ctx: ToolContext;
  toolName: string;
  itemId: string;
  /** Plain-English summary for the undo strip. Should reference MASH-N. */
  summary: string;
  /** Fields to write. Same shape as the row. */
  patch: Record<string, unknown>;
  /** Optional override — by default, a patch_s2d_item undo from the prior row. */
  customUndo?: UndoPayload | null;
}

export interface PatchS2DResult {
  item: Record<string, unknown> | null;
  _agent_action_id: string;
  _undo_expires_at: string | null;
  _undo_summary: string;
}

export async function patchS2DItem(opts: PatchS2DOpts): Promise<PatchS2DResult> {
  const { ctx, toolName, itemId, summary, patch, customUndo } = opts;

  const priorRes = await ctx.supabase
    .from("s2d_items")
    .select("*")
    .eq("user_id", ctx.userId)
    .eq("id", itemId)
    .maybeSingle();
  if (priorRes.error) throw priorRes.error;
  if (!priorRes.data) {
    throw new Error(`No item with id=${itemId}`);
  }
  const prior = priorRes.data as Record<string, unknown>;

  const undoPayload: UndoPayload =
    customUndo === undefined ? snapshotS2DPrior(itemId, prior) : (customUndo as UndoPayload);

  const upd = await ctx.supabase
    .from("s2d_items")
    .update(patch)
    .eq("user_id", ctx.userId)
    .eq("id", itemId)
    .select("*")
    .maybeSingle();
  if (upd.error) throw upd.error;

  const { actionId, expiresAt } = await recordAction({
    userId: ctx.userId,
    threadId: ctx.threadId ?? null,
    toolName,
    ring: "write_mashi",
    args: { id: itemId, patch },
    result: upd.data,
    ok: true,
    summary,
    undoPayload,
    supabase: ctx.supabase,
  });

  return {
    item: (upd.data as Record<string, unknown> | null) ?? null,
    _agent_action_id: actionId,
    _undo_expires_at: expiresAt,
    _undo_summary: summary,
  };
}

/** Builds the "MASH-N, title" label for undo summaries. */
export function itemRef(row: { ticket_number?: number | null; title?: string | null }): string {
  if (row.ticket_number != null) {
    return `MASH-${row.ticket_number}`;
  }
  return row.title ?? "item";
}
