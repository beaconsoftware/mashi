import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";
import { patchS2DItem, itemRef } from "@/lib/agent/tools/_s2d_write_helper";

const args = z.object({
  item_id: z.string().uuid(),
  /** What outcome the user is watching for. Writes to description. */
  watch_for: z.string().min(1).max(1000),
});

type Args = z.infer<typeof args>;

/**
 * Set the "watching for" summary on a `watching`-pathway item. The
 * WatchCanvas stores this in `description` (visible everywhere the
 * item surfaces), so we just patch description.
 */
export const set_watch_target: ToolDefinition<Args, unknown> = {
  name: "set_watch_target",
  description:
    "Set the 'watching for' summary on a watching-pathway item (stored as description). Ring 2, undoable for 30s.",
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
      toolName: "set_watch_target",
      itemId: input.item_id,
      summary: `Set watch target on ${ref}`,
      patch: { description: input.watch_for },
    });
  },
};
