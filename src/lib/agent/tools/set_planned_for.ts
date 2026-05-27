import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";
import { patchS2DItem, itemRef } from "@/lib/agent/tools/_s2d_write_helper";

const args = z.object({
  id: z.string().uuid(),
  /** YYYY-MM-DD or null to clear. */
  date: z.string().nullable(),
});

type Args = z.infer<typeof args>;

export const set_planned_for: ToolDefinition<Args, unknown> = {
  name: "set_planned_for",
  description:
    "Set or clear the planned_for date (YYYY-MM-DD) on an item — when the user expects to work on it. Pass null to unplan. Ring 2, undoable for 30s.",
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
    const label = input.date ? `planned ${ref} for ${input.date}` : `unplanned ${ref}`;
    return patchS2DItem({
      ctx,
      toolName: "set_planned_for",
      itemId: input.id,
      summary: label.charAt(0).toUpperCase() + label.slice(1),
      patch: { planned_for: input.date },
    });
  },
};
