import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";
import { recordAction } from "@/lib/agent/undo";

const args = z.object({ id: z.string().uuid() });
type Args = z.infer<typeof args>;

/**
 * Reject a review-queue item. We do a hard delete from s2d_items
 * (matching the existing client-side "Reject" affordance which calls
 * DELETE /api/s2d/[id]). The undo restores the entire row.
 */
export const reject_review_item: ToolDefinition<Args, unknown> = {
  name: "reject_review_item",
  description:
    "Reject a needs_review item (deletes it). Undo restores the full row for 30s.",
  ring: "write_mashi",
  args,
  handler: async (input, ctx) => {
    const priorRes = await ctx.supabase
      .from("s2d_items")
      .select("*")
      .eq("user_id", ctx.userId)
      .eq("id", input.id)
      .maybeSingle();
    if (priorRes.error) throw priorRes.error;
    if (!priorRes.data) throw new Error(`No item with id=${input.id}`);
    const prior = priorRes.data as Record<string, unknown>;

    const del = await ctx.supabase
      .from("s2d_items")
      .delete()
      .eq("user_id", ctx.userId)
      .eq("id", input.id);
    if (del.error) throw del.error;

    const ref =
      prior.ticket_number != null ? `MASH-${prior.ticket_number}` : "item";
    const { actionId, expiresAt } = await recordAction({
      userId: ctx.userId,
      threadId: ctx.threadId ?? null,
      toolName: "reject_review_item",
      ring: "write_mashi",
      args: input,
      result: { deleted_id: input.id },
      ok: true,
      summary: `Rejected ${ref}`,
      undoPayload: {
        kind: "insert_row",
        table: "s2d_items",
        row: prior,
      },
      supabase: ctx.supabase,
    });

    return {
      deleted_id: input.id,
      _agent_action_id: actionId,
      _undo_expires_at: expiresAt,
      _undo_summary: `Rejected ${ref}`,
    };
  },
};
