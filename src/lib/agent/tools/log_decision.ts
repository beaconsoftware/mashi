import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";
import {
  recordAction,
  snapshotS2DPrior,
  type UndoPayload,
} from "@/lib/agent/undo";

const args = z.object({
  item_id: z.string().uuid(),
  choice: z.enum(["yes", "yes_but", "no", "defer"]),
  note: z.string().max(4_000).optional(),
  /** Required when choice='yes_but' — the gating condition. */
  condition: z.string().max(500).optional(),
  /** Required when choice='defer' — ISO date or timestamp. */
  defer_until: z.string().optional(),
  sources_cited: z.array(z.string()).optional(),
});

type Args = z.infer<typeof args>;

/**
 * Record a decision on an item. Mirrors the existing DecideCanvas
 * behavior: writes decision_log JSONB + decision_note + decision_at, and
 * for 'yes'/'no'/'yes_but' closes the item (status=done). 'defer' moves
 * the item to in_queue with the deferred timestamp.
 *
 * The undo restores decision_log + decision_note + decision_at + status
 * + done_at + queue fields from the prior row, so the original item
 * state is fully recoverable.
 */
export const log_decision: ToolDefinition<Args, unknown> = {
  name: "log_decision",
  description:
    "Record a decision on an item: choice=yes/yes_but/no/defer + optional note. yes/no/yes_but close the item; defer queues it until defer_until. Ring 2, undoable for 30s.",
  ring: "write_mashi",
  args,
  handler: async (input, ctx) => {
    const priorRes = await ctx.supabase
      .from("s2d_items")
      .select("*")
      .eq("user_id", ctx.userId)
      .eq("id", input.item_id)
      .maybeSingle();
    if (priorRes.error) throw priorRes.error;
    if (!priorRes.data) throw new Error(`No item with id=${input.item_id}`);
    const prior = priorRes.data as Record<string, unknown>;
    const ref =
      prior.ticket_number != null ? `MASH-${prior.ticket_number}` : "item";

    const now = new Date().toISOString();
    const decisionLog: Record<string, unknown> = {
      choice: input.choice,
      decidedAt: now,
    };
    if (input.note) decisionLog.note = input.note;
    if (input.condition) decisionLog.condition = input.condition;
    if (input.defer_until) decisionLog.deferUntil = input.defer_until;
    if (input.sources_cited) decisionLog.sourcesCited = input.sources_cited;

    const patch: Record<string, unknown> = {
      decision_log: decisionLog,
      decision_note: input.note ?? null,
      decision_at: now,
    };

    if (input.choice === "defer") {
      if (!input.defer_until) {
        throw new Error("choice='defer' requires defer_until");
      }
      patch.status = "in_queue";
      patch.queue_reason = "deferred";
      patch.queue_until = input.defer_until;
      patch.snoozed_until = input.defer_until;
    } else {
      patch.status = "done";
      patch.done_at = now;
      patch.resolved_via = `decision:${input.choice}`;
    }

    const upd = await ctx.supabase
      .from("s2d_items")
      .update(patch)
      .eq("user_id", ctx.userId)
      .eq("id", input.item_id)
      .select("*")
      .maybeSingle();
    if (upd.error) throw upd.error;

    const summary = `Decided ${input.choice.toUpperCase()} on ${ref}`;
    const undoPayload: UndoPayload = snapshotS2DPrior(input.item_id, prior);

    const { actionId, expiresAt } = await recordAction({
      userId: ctx.userId,
      threadId: ctx.threadId ?? null,
      toolName: "log_decision",
      ring: "write_mashi",
      args: input,
      result: upd.data,
      ok: true,
      summary,
      undoPayload,
      supabase: ctx.supabase,
    });

    return {
      item: upd.data,
      _agent_action_id: actionId,
      _undo_expires_at: expiresAt,
      _undo_summary: summary,
    };
  },
};
