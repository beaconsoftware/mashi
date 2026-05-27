import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";
import { patchS2DItem, itemRef } from "@/lib/agent/tools/_s2d_write_helper";

const args = z.object({
  item_id: z.string().uuid(),
  status: z.enum(["done", "skipped"]),
  outcome: z.string().max(2000).optional(),
});

type Args = z.infer<typeof args>;

/**
 * Complete the active sprint block for an item: mark done (resolved
 * cleanly) or skipped (moves back to todo, retains queue context). The
 * client-side sprint store reads the s2d_items status to promote the
 * next queued block, so this is the canonical way to advance the
 * sprint from chat.
 */
export const complete_block: ToolDefinition<Args, unknown> = {
  name: "complete_block",
  description:
    "Complete the sprint block for an item: status='done' (closes it) or status='skipped' (back to todo). Optionally record an outcome. Ring 2, undoable for 30s.",
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

    const patch: Record<string, unknown> =
      input.status === "done"
        ? {
            status: "done",
            done_at: new Date().toISOString(),
            ...(input.outcome ? { outcome: input.outcome } : {}),
          }
        : {
            status: "todo",
            ...(input.outcome ? { outcome: input.outcome } : {}),
          };

    const label = input.status === "done" ? `Completed` : `Skipped`;
    return patchS2DItem({
      ctx,
      toolName: "complete_block",
      itemId: input.item_id,
      summary: `${label} ${ref}`,
      patch,
    });
  },
};
