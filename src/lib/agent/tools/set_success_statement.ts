import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";
import type { ReverseOp } from "@/lib/agent/undo";

const args = z.object({
  item_id: z.string().uuid(),
  statement: z.string().max(500),
});

type Args = z.infer<typeof args>;

/**
 * Set the success statement on an item, the one-line "what good looks
 * like" used by the sprint focus identity strip.
 */
export const set_success_statement: ToolDefinition<
  Args,
  {
    ok: boolean;
    item?: unknown;
    error?: string;
    _undo?: { summary: string; op: ReverseOp };
  }
> = {
  name: "set_success_statement",
  description:
    "Set the one-line success statement on an item. The sprint focus identity strip surfaces this above the title. Reversible for 30 seconds.",
  ring: "write_mashi",
  args,
  handler: async (input, ctx) => {
    const before = await ctx.supabase
      .from("s2d_items")
      .select("ticket_number, success_statement")
      .eq("user_id", ctx.userId)
      .eq("id", input.item_id)
      .maybeSingle();
    if (before.error) throw before.error;
    if (!before.data) return { ok: false, error: "Item not found." };

    const { data, error } = await ctx.supabase
      .from("s2d_items")
      .update({ success_statement: input.statement })
      .eq("user_id", ctx.userId)
      .eq("id", input.item_id)
      .select("*")
      .maybeSingle();
    if (error) throw error;

    const ticket = before.data.ticket_number;
    const ref = ticket != null ? `MASH-${ticket}` : "item";

    return {
      ok: true,
      item: data,
      _undo: {
        summary: `Set success statement on ${ref}`,
        op: {
          kind: "update_item_fields",
          id: input.item_id,
          prior: { success_statement: before.data.success_statement },
        },
      },
    };
  },
};
