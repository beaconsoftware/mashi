import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";
import type { ReverseOp } from "@/lib/agent/undo";

const args = z.object({
  id: z.string().uuid(),
  description: z.string().nullable(),
});

type Args = z.infer<typeof args>;

/**
 * Set or clear the description on a single S2D item. Strict single-
 * field setter carved out of update_item.
 */
export const set_item_description: ToolDefinition<
  Args,
  {
    ok: boolean;
    item?: unknown;
    error?: string;
    _undo?: { summary: string; op: ReverseOp };
  }
> = {
  name: "set_item_description",
  description:
    "Set the description (longer-form notes) on a single S2D item, or clear it by passing null.\n\nUse when: the user wants to add context to an item ('add a note that we're waiting on legal'), rewrite a stale description, or remove one entirely. Example: { id: '…uuid…', description: 'Waiting on legal sign-off before sending the revised proposal.' }.\n\nDo NOT use for the one-line title (use set_item_title) or for the sprint focus statement (use set_success_statement). Do NOT use to update multiple fields at once; use update_item.\n\nReturns: { ok, item, _undo } on success; { ok: false, error } when the item is missing. Reversible for 30 seconds.",
  ring: "write_mashi",
  args,
  handler: async (input, ctx) => {
    const before = await ctx.supabase
      .from("s2d_items")
      .select("ticket_number, description")
      .eq("user_id", ctx.userId)
      .eq("id", input.id)
      .maybeSingle();
    if (before.error) throw before.error;
    if (!before.data) return { ok: false, error: "Item not found." };

    const { data, error } = await ctx.supabase
      .from("s2d_items")
      .update({ description: input.description })
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
          input.description == null
            ? `Cleared description on ${ref}`
            : `Updated description on ${ref}`,
        op: {
          kind: "update_item_fields",
          id: input.id,
          prior: { description: before.data.description ?? null },
        },
      },
    };
  },
};
