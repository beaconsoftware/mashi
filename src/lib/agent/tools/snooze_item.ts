import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";
import type { ReverseOp } from "@/lib/agent/undo";

const args = z.object({
  id: z.string().uuid(),
  until: z
    .string()
    .min(8)
    .describe("ISO datetime or YYYY-MM-DD date. Resolves to UTC."),
});

type Args = z.infer<typeof args>;

/**
 * Snooze an item: status=in_queue, snoozed_until=until. Undo restores
 * the prior status + snoozed_until.
 */
export const snooze_item: ToolDefinition<
  Args,
  {
    ok: boolean;
    item?: unknown;
    error?: string;
    _undo?: { summary: string; op: ReverseOp };
  }
> = {
  name: "snooze_item",
  description:
    "Snooze an item until a given datetime. Sets status=in_queue and snoozed_until. Pass an ISO datetime (2026-06-01T09:00:00Z) or a YYYY-MM-DD date.",
  ring: "write_mashi",
  args,
  handler: async (input, ctx) => {
    const parsed = new Date(input.until);
    if (Number.isNaN(parsed.getTime())) {
      return { ok: false, error: "Invalid `until` datetime." };
    }
    const until = parsed.toISOString();

    const before = await ctx.supabase
      .from("s2d_items")
      .select("ticket_number, status, snoozed_until")
      .eq("user_id", ctx.userId)
      .eq("id", input.id)
      .maybeSingle();
    if (before.error) throw before.error;
    if (!before.data) return { ok: false, error: "Item not found." };

    const { data, error } = await ctx.supabase
      .from("s2d_items")
      .update({ status: "in_queue", snoozed_until: until })
      .eq("user_id", ctx.userId)
      .eq("id", input.id)
      .select("*")
      .maybeSingle();
    if (error) throw error;

    const ticket = before.data.ticket_number;
    const ref = ticket != null ? `MASH-${ticket}` : "item";
    const dateLabel = until.slice(0, 10);

    return {
      ok: true,
      item: data,
      _undo: {
        summary: `Snoozed ${ref} until ${dateLabel}`,
        op: {
          kind: "update_item_fields",
          id: input.id,
          prior: {
            status: before.data.status,
            snoozed_until: before.data.snoozed_until,
          },
        },
      },
    };
  },
};
