import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";
import { patchS2DItem, itemRef } from "@/lib/agent/tools/_s2d_write_helper";

const args = z.object({
  item_id: z.string().uuid(),
  statement: z.string().min(1).max(500),
});

type Args = z.infer<typeof args>;

/**
 * Record what 'success' on this item looks like in one sentence. Used
 * by the sprint-complete recap and the heads-down canvas pre-warm.
 */
export const set_success_statement: ToolDefinition<Args, unknown> = {
  name: "set_success_statement",
  description:
    "Set a one-sentence success statement on an item (what 'done' looks like). Surfaced in the heads-down canvas and the sprint-complete recap. Ring 2, undoable for 30s.",
  ring: "write_mashi",
  args,
  handler: async (input, ctx) => {
    const priorRes = await ctx.supabase
      .from("s2d_items")
      .select("ticket_number, title")
      .eq("user_id", ctx.userId)
      .eq("id", input.item_id)
      .maybeSingle();
    const ref = itemRef(priorRes.data ?? {});
    return patchS2DItem({
      ctx,
      toolName: "set_success_statement",
      itemId: input.item_id,
      summary: `Set success statement on ${ref}`,
      patch: { success_statement: input.statement },
    });
  },
};
