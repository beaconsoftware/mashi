import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";
import type { ReverseOp } from "@/lib/agent/undo";

const args = z.object({
  id: z.string().uuid(),
  priority: z.enum(["urgent", "high", "medium", "low"]),
});

type Args = z.infer<typeof args>;

/**
 * Change priority on a single S2D item. Strict single-field setter
 * carved out of update_item.
 */
export const set_item_priority: ToolDefinition<
  Args,
  {
    ok: boolean;
    item?: unknown;
    error?: string;
    _undo?: { summary: string; op: ReverseOp };
  }
> = {
  name: "set_item_priority",
  description:
    "Set the priority on a single S2D item. One of: urgent, high, medium, low.\n\nUse when: the user explicitly asks to escalate or de-prioritize an item ('make MASH-1408 urgent', 'this can wait, drop to low'). Example: { id: '…uuid…', priority: 'urgent' }.\n\nDo NOT use to update multiple fields at once; use update_item.\n\nReturns: { ok, item, _undo } on success; { ok: false, error } when the item is missing. Reversible for 30 seconds.",
  ring: "write_mashi",
  args,
  handler: async (input, ctx) => {
    const before = await ctx.supabase
      .from("s2d_items")
      .select("ticket_number, priority")
      .eq("user_id", ctx.userId)
      .eq("id", input.id)
      .maybeSingle();
    if (before.error) throw before.error;
    if (!before.data) return { ok: false, error: "Item not found." };

    const { data, error } = await ctx.supabase
      .from("s2d_items")
      .update({ priority: input.priority })
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
        summary: `Set ${ref} priority to ${input.priority}`,
        op: {
          kind: "update_item_fields",
          id: input.id,
          prior: { priority: before.data.priority },
        },
      },
    };
  },
};
