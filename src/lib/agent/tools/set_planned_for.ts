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
export const set_planned_for: ToolDefinition<
  Args,
  {
    ok: boolean;
    item?: unknown;
    error?: string;
    _undo?: { summary: string; op: ReverseOp };
  }
> = {
  name: "set_planned_for",
  description:
    "Pin an item to a specific day, or clear with null. Pass a YYYY-MM-DD date. Reversible for 30 seconds.",
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
