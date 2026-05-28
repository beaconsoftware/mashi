import { recordAction, type ReverseOp } from "@/lib/agent/undo";
import type { PostToolUseHook } from "@/lib/agent/hooks/types";

/**
 * Quality Phase 4 — write audit + undo emission as a PostToolUse hook.
 *
 * Replaces the inline branches at the original loop.ts:530-573 (ring 2
 * undoable audit) and loop.ts:602-625 (ring 3 success audit). The hook
 * matches every write ring; for ring='write_mashi' it also reads the
 * _undo payload off the result, audits it, and surfaces the in-chat
 * undo strip via `emitUndoable`.
 *
 * The _undo field has already been peeled off the model-facing result
 * by the loop (the strip lives at the audit layer, not in the wire
 * shape sent to the model), and is passed in via `result` here as
 * `{ ok, _undo, ... }`. When _undo is absent the hook still audits the
 * write but no undo strip surfaces.
 */
export const ring2AuditHook: PostToolUseHook = {
  name: "ring2-audit",
  matches: (_toolName, ring) => ring === "write_mashi" || ring === "write_world",
  async run(opts) {
    const { ctx, toolName, input, result, ok, ring } = opts;
    if (!ctx.threadId) return;

    let undoPayload: ReverseOp | null = null;
    let undoSummary: string | null = null;
    if (ring === "write_mashi" && ok && isObjectResult(result)) {
      const raw = (result as { _undo?: { summary: string; op: ReverseOp } })
        ._undo;
      if (raw && raw.op && raw.summary) {
        undoPayload = raw.op;
        undoSummary = raw.summary;
      }
    }

    try {
      const recorded = await recordAction({
        userId: ctx.userId,
        threadId: ctx.threadId,
        toolName,
        ring,
        args: input,
        result,
        ok,
        undoPayload,
        undoSummary,
        supabase: ctx.supabase,
      });
      if (recorded.undoSummary && recorded.undoExpiresAt) {
        opts.emitUndoable?.({
          token: recorded.id,
          summary: recorded.undoSummary,
          expiresAt: recorded.undoExpiresAt,
          toolName,
        });
      }
    } catch (err) {
      console.warn(
        "[agent.hooks] ring2-audit recordAction failed:",
        err instanceof Error ? err.message : err
      );
    }
  },
};

function isObjectResult(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}
