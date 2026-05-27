import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";
import type { ReverseOp } from "@/lib/agent/undo";

const args = z.object({
  id: z.string().uuid(),
  pathway: z.enum([
    "quick_reply",
    "drafted_response",
    "meeting_backed",
    "heads_down",
    "decision_gate",
    "delegated",
    "watching",
  ]),
});

type Args = z.infer<typeof args>;

/**
 * Change an item's pathway. If the item is in an active sprint slot,
 * the client-side sprint store will detect the pathway change on its
 * next poll and re-warm the canvas — the server-side prewarm scheduler
 * lives in client code, so we leave that handoff to the UI.
 */
export const set_pathway: ToolDefinition<
  Args,
  {
    ok: boolean;
    item?: unknown;
    error?: string;
    _undo?: { summary: string; op: ReverseOp };
  }
> = {
  name: "set_pathway",
  description:
    "Re-pathway an item. One of: quick_reply, drafted_response, meeting_backed, heads_down, decision_gate, delegated, watching. Reversible for 30 seconds.",
  ring: "write_mashi",
  args,
  handler: async (input, ctx) => {
    const before = await ctx.supabase
      .from("s2d_items")
      .select("ticket_number, pathway")
      .eq("user_id", ctx.userId)
      .eq("id", input.id)
      .maybeSingle();
    if (before.error) throw before.error;
    if (!before.data) return { ok: false, error: "Item not found." };

    const { data, error } = await ctx.supabase
      .from("s2d_items")
      .update({ pathway: input.pathway })
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
        summary: `Re-pathwayed ${ref} to ${input.pathway}`,
        op: {
          kind: "update_item_fields",
          id: input.id,
          prior: { pathway: before.data.pathway },
        },
      },
    };
  },
};
