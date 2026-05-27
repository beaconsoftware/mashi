import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";
import type { ReverseOp } from "@/lib/agent/undo";

const args = z.object({ id: z.string().uuid() });
type Args = z.infer<typeof args>;

/**
 * Clear the needs_review flag on a triaged item, moving it from the
 * Review column onto the main board. Undo restores needs_review=true.
 */
export const approve_review_item: ToolDefinition<
  Args,
  {
    ok: boolean;
    item?: unknown;
    error?: string;
    _undo?: { summary: string; op: ReverseOp };
  }
> = {
  name: "approve_review_item",
  description:
    "Approve an item currently in the Review column (clears needs_review). Reversible for 30 seconds.",
  ring: "write_mashi",
  args,
  handler: async (input, ctx) => {
    const before = await ctx.supabase
      .from("s2d_items")
      .select("ticket_number, needs_review")
      .eq("user_id", ctx.userId)
      .eq("id", input.id)
      .maybeSingle();
    if (before.error) throw before.error;
    if (!before.data) return { ok: false, error: "Item not found." };
    if (!before.data.needs_review)
      return { ok: false, error: "Item is not in Review." };

    const { data, error } = await ctx.supabase
      .from("s2d_items")
      .update({ needs_review: false })
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
        summary: `Approved ${ref} from Review`,
        op: {
          kind: "restore_review",
          id: input.id,
          prior_needs_review: true,
        },
      },
    };
  },
};
