import type { PostToolUseHook } from "@/lib/agent/hooks/types";

/**
 * Quality Phase 4 — smoke-test PostToolUse hook.
 *
 * Logs a single debug line per tool call so we have proof the hook
 * chain is firing in production. Keep this in the registry as
 * documentation-by-example: it's the canonical shape for non-write
 * cross-cutting concerns (telemetry, tracing, lightweight metrics).
 *
 * Stays cheap on purpose — string formatting, single console.debug,
 * no DB or network. If a heavier observability layer arrives later,
 * either swap the body for it or fork a new hook and remove this.
 */
export const logToolCallHook: PostToolUseHook = {
  name: "log-tool-call",
  matches: () => true,
  async run(opts) {
    const summary =
      opts.ok && opts.result != null
        ? "ok"
        : `error:${opts.ok ? "soft" : "thrown"}`;
    console.debug(
      `[agent.hooks] ${opts.toolName} ring=${opts.ring} → ${summary}`
    );
  },
};
