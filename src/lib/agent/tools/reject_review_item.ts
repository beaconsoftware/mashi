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
    "Reject a triaged item from the Review column: soft-deletes by setting status=done, resolved_via=abandoned, done_at=now, and clearing needs_review.\n\nUse when: the user explicitly dismisses a triaged item ('no, drop that one', 'reject MASH-1408'). Example: { id: '…uuid…' }.\n\nDo NOT use to approve (call approve_review_item). Do NOT use to complete a real done item (use complete_item, which sets resolved_via='done'). Use list_needs_review or get_item to confirm needs_review=true first.\n\nReturns: { ok, item, _undo } on success; { ok: false, error } when the item is missing or not in Review. Reversible for 30 seconds.",
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
