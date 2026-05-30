import type { ToolContext, ToolRing } from "@/lib/agent/types";

/**
 * Quality Phase 4 — agent loop hook contract.
 *
 * Hooks let us layer behavior around tool dispatch without growing the
 * loop itself. The two phases are mirrored from Claude Code's hook
 * system: `PreToolUse` runs before the handler and can short-circuit
 * (deny / ask) or rewrite the input (transform); `PostToolUse` runs
 * after the handler and is fire-and-forget (audit, undo, telemetry).
 *
 * The runner iterates the registered chain in declaration order. The
 * first non-`allow` decision wins; subsequent hooks don't see the call.
 * Transforms accumulate — a later hook can read the rewritten input
 * via the runner's effectiveInput, but the loop is the one that finally
 * dispatches the handler.
 */

export type HookDecision =
  | { decision: "allow" }
  // Short-circuit with an error tool_result. The runner serializes
  // `message` as the content and marks is_error=true.
  | { decision: "deny"; message: string }
  // Short-circuit by emitting a synthetic non-error tool_result. Used
  // by the ring-3 approval hook when the user picks "Edit" — the loop
  // returns the edited_args payload as a normal-looking result so the
  // model re-issues the tool with the new arguments.
  | { decision: "respond"; content: string; isError: boolean }
  // Surface a follow-up question to the user; the loop halts after
  // emitting it. Reserved for hooks that need to clarify mid-flight.
  | { decision: "ask"; message: string }
  // Rewrite the tool input — and optionally the tool itself — before
  // dispatch. Subsequent hooks see the new input (transforms
  // accumulate); the handler runs against the last transform's value.
  // When `toolName` is set the dispatcher swaps to that tool, which is
  // how the dedup hook redirects create_item into update_item against
  // an existing matching row.
  | {
      decision: "transform";
      input: unknown;
      rationale: string;
      toolName?: string;
    };

export interface PreToolUseHook {
  name: string;
  /** Only run for tools matching this predicate. */
  matches: (toolName: string, ring: ToolRing) => boolean;
  run: (opts: {
    toolName: string;
    input: unknown;
    ring: ToolRing;
    ctx: ToolContext;
    /** Anthropic tool_use_id of the call being gated. Hooks that need
     * to bridge to the existing approval channel use this as the
     * correlation key. */
    callId: string;
    /** When a hook emits `ask`, the runner relays this delta to the UI
     * via the loop. Hooks should NOT call this directly for any other
     * purpose; the loop owns delta emission. */
    emitFollowUp?: (opts: {
      id: string;
      question: string;
      options?: string[];
    }) => void;
    /** Emitted by ring3-approval to surface the inline approval card. */
    emitApprovalNeeded?: (opts: {
      id: string;
      name: string;
      args: unknown;
      expiresAt: string;
      /** E2: optional before-snapshot the card diffs against the patch. */
      context?: unknown;
    }) => void;
    emitApprovalResolved?: (opts: {
      id: string;
      outcome: "approve" | "edit" | "cancel" | "expired";
    }) => void;
  }) => Promise<HookDecision>;
}

export interface PostToolUseHook {
  name: string;
  matches: (toolName: string, ring: ToolRing) => boolean;
  run: (opts: {
    toolName: string;
    input: unknown;
    result: unknown;
    ok: boolean;
    ring: ToolRing;
    ctx: ToolContext;
    /** Emitted by ring2-audit when the tool returned an _undo payload, or
     * (E4) a non-recallable ring-3 send note. */
    emitUndoable?: (opts: {
      token: string;
      summary: string;
      expiresAt?: string;
      toolName: string;
      recallable?: boolean;
    }) => void;
  }) => Promise<void>;
}

/**
 * Mutable model-facing result. Ring 2 tools attach a private `_undo`
 * field to their return shape that the model must NOT see; the audit
 * hook peels it off and stashes the cleaned shape here so the loop
 * can serialize the right thing back as the tool_result content.
 */
export interface PostToolUseRewrite {
  modelResult: unknown;
}
