import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";
import type { ReverseOp } from "@/lib/agent/undo";

const args = z.object({
  id: z.string().uuid(),
  date: z.string().nullable(),
});

type Args = z.infer<typeof args>;

/**
 * Set or clear an item's planned-for date. YYYY-MM-DD or null to clear.
 */
export const set_item_planned_for: ToolDefinition<
  Args,
  {
    ok: boolean;
    item?: unknown;
    error?: string;
    _undo?: { summary: string; op: ReverseOp };
  }
> = {
  name: "set_item_planned_for",
  description:
    "Pin an S2D item to a specific calendar day, or clear it back to unscheduled. The argument is a YYYY-MM-DD date (e.g. '2026-06-03'), or null to clear.\n\nUse when: the user explicitly schedules an item ('do this tomorrow', 'plan MASH-1408 for Friday') or asks to remove a previous date. Example: { id: '…uuid…', date: '2026-06-03' }.\n\nDo NOT use to snooze (which also moves status to in_queue) — call snooze_item instead. Do NOT use to update multiple fields at once; use update_item.\n\nReturns: { ok, item, _undo } on success; { ok: false, error } when the date is malformed or the item is missing. Reversible for 30 seconds.",
  ring: "write_mashi",
  args,
  handler: async (input, ctx) => {
    if (input.date != null && !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
      return { ok: false, error: "date must be YYYY-MM-DD or null." };
    }
    const before = await ctx.supabase
      .from("s2d_items")
      .select("ticket_number, planned_for")
      .eq("user_id", ctx.userId)
      .eq("id", input.id)
      .maybeSingle();
    if (before.error) throw before.error;
    if (!before.data) return { ok: false, error: "Item not found." };

    const { data, error } = await ctx.supabase
      .from("s2d_items")
      .update({ planned_for: input.date })
      .eq("user_id", ctx.userId)
      .eq("id", input.id)
      .select("*")
      .maybeSingle();
    if (error) throw error;

    const ticket = before.data.ticket_number;
    const ref = ticket != null ? `MASH-${ticket}` : "item";

    return {
      ok: true,
      item: data,
      _undo: {
        summary:
          input.date == null
            ? `Cleared planned date on ${ref}`
            : `Planned ${ref} for ${input.date}`,
        op: {
          kind: "update_item_fields",
          id: input.id,
          prior: { planned_for: before.data.planned_for },
        },
      },
    };
  },
};
