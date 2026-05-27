import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";
import type { ReverseOp } from "@/lib/agent/undo";

const args = z.object({
  item_id: z.string().uuid(),
  status: z.enum(["done", "skipped"]),
  outcome: z.string().optional(),
});

type Args = z.infer<typeof args>;

/**
 * Settle a sprint slot from the agent. status=done → s2d.status=done,
 * done_at=now. status=skipped → s2d.status=todo (returns to board) +
 * outcome blurb captures why. The live-sprint client store will pick
 * up the change on its next data refresh; if the user is currently in
 * the slot the canvas re-renders the new status.
 */
export const complete_block: ToolDefinition<
  Args,
  {
    ok: boolean;
    item?: unknown;
    error?: string;
    _undo?: { summary: string; op: ReverseOp };
  }
> = {
  name: "complete_block",
  description:
    "Settle a sprint slot from the agent: status=done marks the item done; status=skipped returns it to the To Do column with an optional outcome blurb. Reversible for 30 seconds.",
  ring: "write_mashi",
  args,
  handler: async (input, ctx) => {
    const before = await ctx.supabase
      .from("s2d_items")
      .select("ticket_number, status, done_at, outcome, resolved_via")
      .eq("user_id", ctx.userId)
      .eq("id", input.item_id)
      .maybeSingle();
    if (before.error) throw before.error;
    if (!before.data) return { ok: false, error: "Item not found." };

    const nowIso = new Date().toISOString();
    const patch: Record<string, unknown> =
      input.status === "done"
        ? {
            status: "done",
            done_at: nowIso,
            outcome: input.outcome ?? before.data.outcome,
            resolved_via: before.data.resolved_via ?? "done",
          }
        : {
            status: "todo",
            outcome: input.outcome ?? before.data.outcome,
          };

    const { data, error } = await ctx.supabase
      .from("s2d_items")
      .update(patch)
      .eq("user_id", ctx.userId)
      .eq("id", input.item_id)
      .select("*")
      .maybeSingle();
    if (error) throw error;

    const ticket = before.data.ticket_number;
    const ref = ticket != null ? `MASH-${ticket}` : "item";
    const summary =
      input.status === "done" ? `Marked ${ref} done` : `Skipped ${ref}`;

    return {
      ok: true,
      item: data,
      _undo: {
        summary,
        op: {
          kind: "update_item_fields",
          id: input.item_id,
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
