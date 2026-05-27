import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";
import type { ReverseOp } from "@/lib/agent/undo";

const args = z.object({ id: z.string().uuid() });
type Args = z.infer<typeof args>;

/**
 * Reject an item from the Review column: soft-delete by marking status
 * done with resolved_via=abandoned. Undo restores the prior status and
 * needs_review=true.
 */
export const reject_review_item: ToolDefinition<
  Args,
  {
    ok: boolean;
    item?: unknown;
    error?: string;
    _undo?: { summary: string; op: ReverseOp };
  }
> = {
  name: "reject_review_item",
  description:
    "Reject an item from Review (soft-deletes via status=done, resolved_via=abandoned). Reversible for 30 seconds.",
  ring: "write_mashi",
  args,
  handler: async (input, ctx) => {
    const before = await ctx.supabase
      .from("s2d_items")
      .select(
        "ticket_number, needs_review, status, resolved_via, done_at, outcome"
      )
      .eq("user_id", ctx.userId)
      .eq("id", input.id)
      .maybeSingle();
    if (before.error) throw before.error;
    if (!before.data) return { ok: false, error: "Item not found." };
    if (!before.data.needs_review)
      return { ok: false, error: "Item is not in Review." };

    const { data, error } = await ctx.supabase
      .from("s2d_items")
      .update({
        status: "done",
        resolved_via: "abandoned",
        done_at: new Date().toISOString(),
        needs_review: false,
      })
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
        summary: `Rejected ${ref} from Review`,
        op: {
          kind: "update_item_fields",
          id: input.id,
          prior: {
            status: before.data.status,
            resolved_via: before.data.resolved_via,
            done_at: before.data.done_at,
            outcome: before.data.outcome,
            needs_review: true,
          },
        },
      },
    };
  },
};
