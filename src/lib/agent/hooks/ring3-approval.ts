import {
  awaitApprovalDecision,
  createPendingApproval,
} from "@/lib/agent/approval";
import { recordAction } from "@/lib/agent/undo";
import type { PreToolUseHook } from "@/lib/agent/hooks/types";

/**
 * Quality Phase 4 — ring-3 approval gate as a PreToolUse hook.
 *
 * Replaces the inline branch at the original loop.ts:409-484. The hook
 * fires for ring='write_world' tools only. It writes a pending row to
 * `agent_approvals`, emits an `approval-needed` SSE delta, and blocks
 * until the user clicks Approve / Edit / Cancel (or the row expires).
 *
 * Outcome mapping:
 *   - approve  → allow (the loop dispatches the handler normally)
 *   - edit     → respond with a non-error synthetic JSON carrying the
 *                edited_args; the model is expected to re-issue the
 *                tool with those args (which lands a fresh approval
 *                gate, by design)
 *   - cancel   → deny with "user cancelled"
 *   - expired  → deny with "approval window expired"
 *
 * Cancel and expired both also write an audit row so the user can see
 * what was attempted even though it didn't execute.
 */
export const ring3ApprovalHook: PreToolUseHook = {
  name: "ring3-approval",
  matches: (_toolName, ring) => ring === "write_world",
  async run(opts) {
    const { ctx, toolName, input, callId } = opts;
    if (!ctx.threadId) {
      // Defensive: ring-3 calls without a thread can't be approved
      // through the in-chat card. Deny rather than executing blind.
      return {
        decision: "deny",
        message: "ring-3 tools require a thread to seek approval",
      };
    }
    const pending = await createPendingApproval({
      userId: ctx.userId,
      threadId: ctx.threadId,
      callId,
      toolName,
      args: input,
      supabase: ctx.supabase,
    });
    opts.emitApprovalNeeded?.({
      id: callId,
      name: toolName,
      args: input,
      expiresAt: pending.expiresAt,
    });
    const outcome = await awaitApprovalDecision({
      userId: ctx.userId,
      threadId: ctx.threadId,
      callId,
      supabase: ctx.supabase,
    });
    if (outcome.kind === "edit") {
      opts.emitApprovalResolved?.({ id: callId, outcome: "edit" });
      const synth = {
        ok: true,
        edited: true,
        edited_args: outcome.editedArgs,
        note: "User edited the call. Re-issue the tool with these arguments to seek a fresh approval.",
      };
      return {
        decision: "respond",
        content: JSON.stringify(synth),
        isError: false,
      };
    }
    if (outcome.kind === "cancel" || outcome.kind === "expired") {
      opts.emitApprovalResolved?.({
        id: callId,
        outcome: outcome.kind === "cancel" ? "cancel" : "expired",
      });
      const error =
        outcome.kind === "cancel"
          ? "user cancelled"
          : "approval window expired";
      try {
        await recordAction({
          userId: ctx.userId,
          threadId: ctx.threadId,
          toolName,
          ring: "write_world",
          args: input,
          result: { ok: false, error },
          ok: false,
          supabase: ctx.supabase,
        });
      } catch {
        // best-effort
      }
      return {
        decision: "respond",
        content: JSON.stringify({ ok: false, error }),
        isError: true,
      };
    }
    // approve — the existing approval channel can carry an args
    // override (the user edited then re-approved without round-tripping
    // through the model). Transform when the approved args differ.
    opts.emitApprovalResolved?.({ id: callId, outcome: "approve" });
    if (
      outcome.args !== undefined &&
      outcome.args !== null &&
      outcome.args !== input
    ) {
      return {
        decision: "transform",
        input: outcome.args,
        rationale: "user approved edited args",
      };
    }
    return { decision: "allow" };
  },
};
