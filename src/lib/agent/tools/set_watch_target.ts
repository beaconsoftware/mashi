import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";
import type { ReverseOp } from "@/lib/agent/undo";

const args = z.object({
  item_id: z.string().uuid(),
  watch_for: z.string().min(1).max(500),
});

type Args = z.infer<typeof args>;

/**
 * Set the watch target on a watching item — a short prose description
 * of the signal that should end the watch. Stored on
 * enriched_context.watch_target. Undo restores the prior value.
 */
export const set_watch_target: ToolDefinition<
  Args,
  {
    ok: boolean;
    item?: unknown;
    error?: string;
    _undo?: { summary: string; op: ReverseOp };
  }
> = {
  name: "set_watch_target",
  description:
    "Set the watch target (what signal should end the watch) on a watching-pathway item. Stored on enriched_context.watch_target. Reversible for 30 seconds.",
  ring: "write_mashi",
  args,
  handler: async (input, ctx) => {
    const before = await ctx.supabase
      .from("s2d_items")
      .select("ticket_number, enriched_context")
      .eq("user_id", ctx.userId)
      .eq("id", input.item_id)
      .maybeSingle();
    if (before.error) throw before.error;
    if (!before.data) return { ok: false, error: "Item not found." };

    const priorCtx =
      (before.data.enriched_context as Record<string, unknown> | null) ?? {};
    const nextCtx = { ...priorCtx, watch_target: input.watch_for };

    const { data, error } = await ctx.supabase
      .from("s2d_items")
      .update({ enriched_context: nextCtx })
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
        summary: `Set watch target on ${ref}`,
        op: {
          kind: "update_item_fields",
          id: input.item_id,
          prior: { enriched_context: priorCtx },
        },
      },
    };
  },
};
