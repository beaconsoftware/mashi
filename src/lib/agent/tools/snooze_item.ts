import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";
import { patchS2DItem, itemRef } from "@/lib/agent/tools/_s2d_write_helper";

const args = z.object({
  id: z.string().uuid(),
  /** ISO timestamp the item should resurface at. */
  until: z.string().datetime(),
  reason: z.string().max(200).optional(),
});

type Args = z.infer<typeof args>;

/**
 * Move an item into the in_queue bucket with a snooze date. The
 * `s2d_items_in_queue_requires_reason` invariant from migration 023
 * forces a `queue_reason` value when status flips to in_queue, so we
 * always set one (default "snoozed").
 */
export const snooze_item: ToolDefinition<Args, unknown> = {
  name: "snooze_item",
  description:
    "Move an item to in_queue with a snoozed_until timestamp. Optionally include a queue reason (defaults to 'snoozed'). Ring 2, undoable for 30s.",
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

    const friendlyDate = new Date(input.until).toISOString().slice(0, 10);
    return patchS2DItem({
      ctx,
      toolName: "snooze_item",
      itemId: input.id,
      summary: `Snoozed ${ref} until ${friendlyDate}`,
      patch: {
        status: "in_queue",
        snoozed_until: input.until,
        queue_reason: input.reason ?? "snoozed",
        queue_until: input.until,
      },
    });
  },
};
