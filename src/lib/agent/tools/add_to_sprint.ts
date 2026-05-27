import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";
import { patchS2DItem, itemRef } from "@/lib/agent/tools/_s2d_write_helper";

const args = z.object({ item_id: z.string().uuid() });
type Args = z.infer<typeof args>;

/**
 * Add an item to the active sprint by flipping its status to
 * in_progress. The sprint store's rehydrate effect picks the item up
 * on the next render. Ring 2, undoable.
 */
export const add_to_sprint: ToolDefinition<Args, unknown> = {
  name: "add_to_sprint",
  description:
    "Pull an item into the active sprint (flips status to in_progress). Ring 2, undoable for 30s.",
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
      toolName: "add_to_sprint",
      itemId: input.item_id,
      summary: `Added ${ref} to sprint`,
      patch: { status: "in_progress" },
    });
  },
};
