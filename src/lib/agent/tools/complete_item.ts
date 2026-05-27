import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";
import type { ReverseOp } from "@/lib/agent/undo";

const args = z.object({
  id: z.string().uuid(),
  outcome: z.string().min(1).max(2000).optional(),
  resolved_via: z
    .enum(["done", "deferred", "delegated", "abandoned", "merged"])
    .optional(),
});

type Args = z.infer<typeof args>;

/**
 * Mark an item done. Sets status=done, done_at=now, plus an optional
 * outcome blurb and resolved_via tag. Undo restores the prior status
 * and clears done_at / outcome / resolved_via.
 */
export const complete_item: ToolDefinition<
  Args,
  {
    ok: boolean;
    item?: unknown;
    error?: string;
    _undo?: { summary: string; op: ReverseOp };
  }
> = {
  name: "complete_item",
  description:
    "Mark an item done. Sets status=done plus an optional outcome blurb and resolved_via tag. Reversible for 30 seconds.",
  ring: "write_mashi",
  args,
  handler: async (input, ctx) => {
    const before = await ctx.supabase
      .from("s2d_items")
      .select("ticket_number, title, status, done_at, outcome, resolved_via")
      .eq("user_id", ctx.userId)
      .eq("id", input.id)
      .maybeSingle();
    if (before.error) throw before.error;
    if (!before.data) return { ok: false, error: "Item not found." };

    const patch = {
      status: "done",
      done_at: new Date().toISOString(),
      outcome: input.outcome ?? before.data.outcome,
      resolved_via: input.resolved_via ?? before.data.resolved_via ?? "done",
    };

    const { data, error } = await ctx.supabase
      .from("s2d_items")
      .update(patch)
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
        summary: `Marked ${ref} done`,
        op: {
          kind: "update_item_fields",
          id: input.id,
          prior: {
            status: before.data.status,
            done_at: before.data.done_at,
            outcome: before.data.outcome,
            resolved_via: before.data.resolved_via,
          },
        },
      },
    };
  },
};
