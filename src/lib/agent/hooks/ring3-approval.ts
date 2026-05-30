import {
  awaitApprovalDecision,
  createPendingApproval,
} from "@/lib/agent/approval";
import { recordAction } from "@/lib/agent/undo";
import { getTool } from "@/lib/agent/registry";
import type { ApprovalContext } from "@/lib/agent/approval-meta";
import { loadToolPolicies } from "@/lib/agent/policy-server";
import { effectiveDecision, scopeForCall } from "@/lib/agent/policy";
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
    // E1: consult the user's per-tool policy BEFORE doing any approval work.
    // `never` blocks outright (no card); an eligible `always_allow` for this
    // scope skips the card and lets the call through (still audited by the
    // post-tool hook); `ask` falls through to the normal gate. A failed
    // policy read defaults to `ask` — never silently widen access.
    const policies = await loadToolPolicies(ctx.userId, ctx.supabase).catch(
      () => []
    );
    const decision = effectiveDecision(
      policies,
      toolName,
      scopeForCall(toolName, input)
    );
    if (decision === "never") {
      const error = "Blocked by your approval policy (set to never).";
      try {
        await recordAction({
          userId: ctx.userId,
          threadId: ctx.threadId,
          toolName,
          ring: "write_world",
          args: input,
          result: { ok: false, error, blocked_by_policy: true },
          ok: false,
          supabase: ctx.supabase,
        });
      } catch {
        // best-effort audit
      }
      return {
        decision: "respond",
        content: JSON.stringify({ ok: false, error, blocked_by_policy: true }),
        isError: true,
      };
    }
    if (decision === "always_allow") {
      // Pre-authorized for this scope. No card; the post-tool audit hook
      // records the action so there's still a trail of every bypassed write.
      return { decision: "allow" };
    }

    // E2: ask the tool for a before-snapshot (update tools implement this)
    // so the card can diff current vs proposed. Best-effort: a slow / failing
    // context read must not block the approval, so swallow and proceed.
    let context: ApprovalContext | null = null;
    try {
      context =
        (await getTool(toolName)?.approvalContext?.(input, ctx)) ?? null;
    } catch {
      context = null;
    }
    const pending = await createPendingApproval({
      userId: ctx.userId,
      threadId: ctx.threadId,
      callId,
      toolName,
      args: input,
      context,
      supabase: ctx.supabase,
    });
    opts.emitApprovalNeeded?.({
      id: callId,
      name: toolName,
      args: input,
      expiresAt: pending.expiresAt,
      context,
    });
    const outcome = await awaitApprovalDecision({
      userId: ctx.userId,
      threadId: ctx.threadId,
      callId,
      supabase: ctx.supabase,
      // A5: stop polling the moment the turn's request is aborted (closed
      // tab / Stop button) instead of burning the full 270s window.
      signal: ctx.signal,
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
      // E3: the model must still see is_error=true so it knows the action did
      // NOT run, but the UI reads the `cancelled` / `expired` marker to render
      // a neutral "Cancelled" outcome instead of an alarming red error.
      const synth =
        outcome.kind === "cancel"
          ? { ok: false, error, cancelled: true }
          : { ok: false, error, expired: true };
      return {
        decision: "respond",
        content: JSON.stringify(synth),
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
