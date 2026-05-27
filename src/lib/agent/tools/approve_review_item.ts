import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";
import { patchS2DItem, itemRef } from "@/lib/agent/tools/_s2d_write_helper";

const args = z.object({ id: z.string().uuid() });
type Args = z.infer<typeof args>;

export const approve_review_item: ToolDefinition<Args, unknown> = {
  name: "approve_review_item",
  description:
    "Clear needs_review on an item (move it from the review queue into the live board). Ring 2, undoable for 30s.",
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
    return patchS2DItem({
      ctx,
      toolName: "approve_review_item",
      itemId: input.id,
      summary: `Approved ${ref}`,
      patch: { needs_review: false },
    });
  },
};
