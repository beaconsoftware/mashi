import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";
import type { ReverseOp } from "@/lib/agent/undo";

const args = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(500),
});

type Args = z.infer<typeof args>;

/**
 * Rewrite the title on a single S2D item. Strict single-field setter
 * carved out of update_item so the model can pick this when only the
 * title is changing, without having to reason about a `patch` blob.
 */
export const set_item_title: ToolDefinition<
  Args,
  {
    ok: boolean;
    item?: unknown;
    error?: string;
    _undo?: { summary: string; op: ReverseOp };
  }
> = {
  name: "set_item_title",
  description:
    "Rewrite the title of a single S2D item. Title is 1-500 chars of free text.\n\nUse when: the user asks to rename an item, or you've detected the triage-generated title is misleading and want to clean it up. Example: { id: '…uuid…', title: 'Q4 brand spend review with Maya' }.\n\nDo NOT use for any field other than title; pick the matching set_item_* tool. Do NOT use to update multiple fields at once; use update_item.\n\nReturns: { ok, item, _undo } on success; { ok: false, error } when the item is missing. Reversible for 30 seconds.",
  ring: "write_mashi",
  args,
  handler: async (input, ctx) => {
    const before = await ctx.supabase
      .from("s2d_items")
      .select("ticket_number, title")
      .eq("user_id", ctx.userId)
      .eq("id", input.id)
      .maybeSingle();
    if (before.error) throw before.error;
    if (!before.data) return { ok: false, error: "Item not found." };

    const { data, error } = await ctx.supabase
      .from("s2d_items")
      .update({ title: input.title })
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
        summary: `Renamed ${ref}`,
        op: {
          kind: "update_item_fields",
          id: input.id,
          prior: { title: before.data.title },
        },
      },
    };
  },
};
