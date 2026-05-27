import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";
import { patchS2DItem, itemRef } from "@/lib/agent/tools/_s2d_write_helper";

const args = z.object({
  id: z.string().uuid(),
  outcome: z.string().min(1).max(2000).optional(),
  resolved_via: z.string().max(200).optional(),
});

type Args = z.infer<typeof args>;

/**
 * Mark an item done. Sets status, done_at, outcome, resolved_via.
 * The undo restores the prior status + done_at + outcome from the
 * pre-mutation snapshot, so an accidental complete reverts cleanly.
 */
export const complete_item: ToolDefinition<Args, unknown> = {
  name: "complete_item",
  description:
    "Mark an S2D item done. Sets status='done', done_at=now, and optionally outcome/resolved_via. Ring 2, undoable for 30s.",
  ring: "write_mashi",
  args,
  handler: async (input, ctx) => {
    const priorRes = await ctx.supabase
      .from("s2d_items")
      .select("ticket_number, title")
      .eq("user_id", ctx.userId)
      .eq("id", input.id)
      .maybeSingle();
    const ref = itemRef(priorRes.data ?? {});

    const patch: Record<string, unknown> = {
      status: "done",
      done_at: new Date().toISOString(),
    };
    if (input.outcome) patch.outcome = input.outcome;
    if (input.resolved_via) patch.resolved_via = input.resolved_via;

    return patchS2DItem({
      ctx,
      toolName: "complete_item",
      itemId: input.id,
      summary: `Completed ${ref}`,
      patch,
    });
  },
};
