import type { ToolContext, ToolRing } from "@/lib/agent/types";
import type {
  HookDecision,
  PostToolUseHook,
  PreToolUseHook,
} from "@/lib/agent/hooks/types";

/**
 * Quality Phase 4 — pre/post-tool hook runners.
 *
 * The loop calls runPreToolHooks before dispatching a tool, runs the
 * handler iff the result is `allow` or `transform`, then calls
 * runPostToolHooks after dispatch (or after a short-circuit, when a
 * pre-tool hook decided to emit its own audit, e.g., ring-3 cancel).
 *
 * Behavior summary:
 *   - allow      → continue to the next hook
 *   - transform  → adopt the new input, continue to the next hook
 *   - deny       → return immediately with this decision
 *   - respond    → return immediately with this decision (non-error synth)
 *   - ask        → return immediately with this decision
 *
 * First non-allow / non-transform decision wins.
 */

export interface PreRunnerOpts {
  toolName: string;
  input: unknown;
  ring: ToolRing;
  ctx: ToolContext;
  callId: string;
  hooks: PreToolUseHook[];
  emitFollowUp?: (opts: {
    id: string;
    question: string;
    options?: string[];
  }) => void;
  emitApprovalNeeded?: (opts: {
    id: string;
    name: string;
    args: unknown;
    expiresAt: string;
    context?: unknown;
  }) => void;
  emitApprovalResolved?: (opts: {
    id: string;
    outcome: "approve" | "edit" | "cancel" | "expired";
  }) => void;
}

export interface PreRunnerResult {
  decision: HookDecision;
  /** Final input after all transforms. Same as the original input when
   * no hook transformed it. The loop uses this as the dispatch input. */
  effectiveInput: unknown;
  /** Final tool name after all transforms. May differ from
   * opts.toolName when a hook redirected (e.g., dedup create →
   * update). The loop uses this to look up the handler. */
  effectiveToolName: string;
}

export async function runPreToolHooks(
  opts: PreRunnerOpts
): Promise<PreRunnerResult> {
  let effectiveInput = opts.input;
  let effectiveToolName = opts.toolName;
  for (const hook of opts.hooks) {
    if (!hook.matches(effectiveToolName, opts.ring)) continue;
    const decision = await hook.run({
      toolName: effectiveToolName,
      input: effectiveInput,
      ring: opts.ring,
      ctx: opts.ctx,
      callId: opts.callId,
      emitFollowUp: opts.emitFollowUp,
      emitApprovalNeeded: opts.emitApprovalNeeded,
      emitApprovalResolved: opts.emitApprovalResolved,
    });
    if (decision.decision === "transform") {
      effectiveInput = decision.input;
      if (decision.toolName) effectiveToolName = decision.toolName;
      continue;
    }
    if (decision.decision !== "allow") {
      return { decision, effectiveInput, effectiveToolName };
    }
  }
  return {
    decision: { decision: "allow" },
    effectiveInput,
    effectiveToolName,
  };
}

export interface PostRunnerOpts {
  toolName: string;
  input: unknown;
  result: unknown;
  ok: boolean;
  ring: ToolRing;
  ctx: ToolContext;
  hooks: PostToolUseHook[];
  emitUndoable?: (opts: {
    token: string;
    summary: string;
    expiresAt?: string;
    toolName: string;
    recallable?: boolean;
  }) => void;
}

export async function runPostToolHooks(opts: PostRunnerOpts): Promise<void> {
  for (const hook of opts.hooks) {
    if (!hook.matches(opts.toolName, opts.ring)) continue;
    try {
      await hook.run({
        toolName: opts.toolName,
        input: opts.input,
        result: opts.result,
        ok: opts.ok,
        ring: opts.ring,
        ctx: opts.ctx,
        emitUndoable: opts.emitUndoable,
      });
    } catch (err) {
      // Hooks are advisory in the post-tool phase. A failed audit
      // shouldn't kill the turn — surface in logs and keep going.
      console.warn(
        `[agent.hooks] postTool ${hook.name} failed:`,
        err instanceof Error ? err.message : err
      );
    }
  }
}
