import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";
import {
  recordAction,
  snapshotS2DPrior,
  type UndoPayload,
} from "@/lib/agent/undo";

const args = z.object({
  primary_id: z.string().uuid(),
  duplicate_ids: z.array(z.string().uuid()).min(1).max(20),
});

type Args = z.infer<typeof args>;

/**
 * Mark duplicate items as done with resolved_via='merged' and stamp
 * the primary item's id in their outcome field so the merge is
 * traceable. The primary row is untouched. Undo restores each
 * duplicate's prior state.
 *
 * This is the minimum-viable merge — we don't reattach linked_sources
 * here. A richer merge that consolidates enriched_context.pulled_sources
 * onto the primary lives behind the existing /api/s2d/consolidate
 * route; the agent tool stays narrow.
 */
export const merge_items: ToolDefinition<Args, unknown> = {
  name: "merge_items",
  description:
    "Close `duplicate_ids` as resolved_via='merged' pointing at `primary_id`. The primary row is untouched. Ring 2, undoable for 30s.",
  ring: "write_mashi",
  args,
  handler: async (input, ctx) => {
    const primary = await ctx.supabase
      .from("s2d_items")
      .select("ticket_number")
      .eq("user_id", ctx.userId)
      .eq("id", input.primary_id)
      .maybeSingle();
    if (primary.error) throw primary.error;
    if (!primary.data) {
      throw new Error(`No primary item with id=${input.primary_id}`);
    }
    const primaryRef =
      primary.data.ticket_number != null
        ? `MASH-${primary.data.ticket_number}`
        : "primary";

    const dups = await ctx.supabase
      .from("s2d_items")
      .select("*")
      .eq("user_id", ctx.userId)
      .in("id", input.duplicate_ids);
    if (dups.error) throw dups.error;
    const dupRows = (dups.data ?? []) as Array<Record<string, unknown>>;

    const undoOps: UndoPayload[] = dupRows.map((row) =>
      snapshotS2DPrior(row.id as string, row)
    );

    const now = new Date().toISOString();
    const upd = await ctx.supabase
      .from("s2d_items")
      .update({
        status: "done",
        done_at: now,
        resolved_via: "merged",
        outcome: `Merged into ${primaryRef}`,
      })
      .eq("user_id", ctx.userId)
      .in("id", input.duplicate_ids)
      .select("id, ticket_number");
    if (upd.error) throw upd.error;

    const summary = `Merged ${dupRows.length} item${dupRows.length === 1 ? "" : "s"} into ${primaryRef}`;
    const { actionId, expiresAt } = await recordAction({
      userId: ctx.userId,
      threadId: ctx.threadId ?? null,
      toolName: "merge_items",
      ring: "write_mashi",
      args: input,
      result: upd.data,
      ok: true,
      summary,
      undoPayload: { kind: "multi", ops: undoOps },
      supabase: ctx.supabase,
    });

    return {
      primary_id: input.primary_id,
      merged: upd.data ?? [],
      _agent_action_id: actionId,
      _undo_expires_at: expiresAt,
      _undo_summary: summary,
    };
  },
};
