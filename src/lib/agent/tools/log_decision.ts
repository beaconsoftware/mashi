import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";
import type { ReverseOp } from "@/lib/agent/undo";

const args = z.object({
  item_id: z.string().uuid(),
  choice: z.enum(["yes", "yes_but", "no", "defer"]),
  note: z.string().min(1).max(2000),
  condition: z.string().max(500).optional(),
  defer_until: z.string().optional(),
  sources_cited: z.array(z.string()).max(20).optional(),
});

type Args = z.infer<typeof args>;

/**
 * Log a structured decision on a decision-gate item. Mirrors what the
 * Decide canvas writes. Writes decision_log (rich JSONB), decision_note
 * (back-compat plain text), decision_at (timestamp).
 *
 * yes_but and defer carry an extra condition / defer_until field. The
 * Phase 6 inheritance hook will later spawn a follow-up item; for now
 * we just stash the structured log.
 */
export const log_decision: ToolDefinition<
  Args,
  {
    ok: boolean;
    item?: unknown;
    error?: string;
    _undo?: { summary: string; op: ReverseOp };
  }
> = {
  name: "log_decision",
  description:
    "Log a structured decision on a decision-gate S2D item. choice is one of: yes, yes_but (with condition), no, defer (with defer_until). Writes decision_log (JSONB), decision_note (plain text), and decision_at.\n\nUse when: the user makes an explicit yes/no/maybe call on a decision-gate item ('go ahead but only if X', 'defer this until next quarter'). Example: { item_id: '…uuid…', choice: 'yes_but', note: 'Approved if legal signs off', condition: 'Legal sign-off' }.\n\nDo NOT use to mark an item done — call complete_item. Do NOT use for non-decision_gate items unless you have a reason; pathway mismatches confuse the Decide canvas.\n\nReturns: { ok, item, _undo } on success; { ok: false, error } when the item is missing. Reversible for 30 seconds.",
  ring: "write_mashi",
  args,
  handler: async (input, ctx) => {
    const before = await ctx.supabase
      .from("s2d_items")
      .select("ticket_number, decision_log, decision_note, decision_at")
      .eq("user_id", ctx.userId)
      .eq("id", input.item_id)
      .maybeSingle();
    if (before.error) throw before.error;
    if (!before.data) return { ok: false, error: "Item not found." };

    const decidedAt = new Date().toISOString();
    const log: Record<string, unknown> = {
      choice: input.choice,
      note: input.note,
      sourcesCited: input.sources_cited ?? [],
      decidedAt,
    };
    if (input.choice === "yes_but" && input.condition) {
      log.condition = input.condition;
    }
    if (input.choice === "defer" && input.defer_until) {
      log.deferUntil = input.defer_until;
    }

    const { data, error } = await ctx.supabase
      .from("s2d_items")
      .update({
        decision_log: log,
        decision_note: input.note,
        decision_at: decidedAt,
      })
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
        summary: `Logged ${input.choice} decision on ${ref}`,
        op: {
          kind: "restore_decision_log",
          id: input.item_id,
          prior_decision_log: before.data.decision_log,
          prior_decision_note: before.data.decision_note,
          prior_decision_at: before.data.decision_at,
        },
      },
    };
  },
};
