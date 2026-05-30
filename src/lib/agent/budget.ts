import type Anthropic from "@anthropic-ai/sdk";
import { costForUsage } from "@/lib/anthropic/tracked";

/**
 * A6 — per-turn token / cost budget for the agent loop.
 *
 * The only ceiling on a turn used to be `maxIterations` (default 6, max
 * 12). With up to 12 Opus round-trips and no token cap, a runaway tool
 * loop was both uncapped in cost and (pre-A2) invisible. This adds a soft
 * budget: the loop accumulates the real usage from each model call's
 * final message and stops gracefully at the next iteration boundary once
 * either the token or cost ceiling is crossed, with a clear terminal
 * message rather than silently continuing.
 *
 * "Soft" is deliberate: we never abort mid-tool or mid-stream. We check
 * between fully-resolved iterations, so the thread is always left coherent
 * (every tool_use answered by a tool_result before we stop).
 *
 * Pure accumulator, no DB / SDK side effects, so it's unit-testable
 * (see `__tests__/budget.test.ts`).
 */

/**
 * Default per-turn token budget. Generous for interactive use — a normal
 * multi-tool turn is well under this; it only bites a genuine runaway.
 * Each iteration re-sends the whole context, so input tokens dominate and
 * accumulate fast; this counts input+output across every round-trip.
 * Scheduled / unattended runs (G1) pass a tighter ceiling.
 */
export const DEFAULT_TURN_TOKEN_BUDGET = 1_500_000;

export interface TurnBudgetOpts {
  /** Token ceiling (input+output, summed across round-trips). */
  maxTokens?: number;
  /** Optional USD ceiling. When set, whichever ceiling trips first wins. */
  maxCostUsd?: number;
}

/**
 * Accumulates token + cost spend across the round-trips of a single turn.
 * Call `add(model, usage)` after each model call's final message, then
 * `exceeded()` at the iteration boundary to decide whether to stop.
 */
export class TurnBudget {
  private readonly maxTokens: number;
  private readonly maxCostUsd: number | null;
  private tokens = 0;
  private costUsd = 0;

  constructor(opts?: TurnBudgetOpts) {
    this.maxTokens = opts?.maxTokens ?? DEFAULT_TURN_TOKEN_BUDGET;
    this.maxCostUsd = opts?.maxCostUsd ?? null;
  }

  /** Fold one model call's usage into the running totals. */
  add(model: string, usage: Anthropic.Messages.Usage | null | undefined): void {
    if (!usage) return;
    const input = usage.input_tokens ?? 0;
    const output = usage.output_tokens ?? 0;
    const cacheRead = usage.cache_read_input_tokens ?? 0;
    const cacheWrite = usage.cache_creation_input_tokens ?? 0;
    this.tokens += input + output + cacheRead + cacheWrite;
    this.costUsd += costForUsage(model, usage);
  }

  get totalTokens(): number {
    return this.tokens;
  }

  get totalCostUsd(): number {
    return this.costUsd;
  }

  /** True once either configured ceiling has been crossed. */
  exceeded(): boolean {
    if (this.tokens >= this.maxTokens) return true;
    if (this.maxCostUsd != null && this.costUsd >= this.maxCostUsd) return true;
    return false;
  }
}
