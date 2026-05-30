/**
 * A6 — unit tests for the per-turn token/cost budget accumulator.
 *
 * Self-running assertion script (no test framework, matching the
 * convention in replay.test.ts / pricing.test.ts). Runs with:
 *   pnpm test:budget
 *
 * Covers the A6 acceptance criterion: a turn that would exceed the budget
 * trips `exceeded()` at the boundary; a healthy turn under the (generous)
 * default never does.
 */
import type Anthropic from "@anthropic-ai/sdk";
import {
  DEFAULT_TURN_TOKEN_BUDGET,
  TurnBudget,
} from "@/lib/agent/budget";
import { MODELS } from "@/lib/anthropic/client";

const stats = { pass: 0, fail: 0 };

function assert(ok: boolean, label: string) {
  if (ok) {
    stats.pass += 1;
    console.log(`  ✓ ${label}`);
  } else {
    stats.fail += 1;
    console.error(`  ✗ ${label}`);
  }
}

function usage(input: number, output: number): Anthropic.Messages.Usage {
  return {
    input_tokens: input,
    output_tokens: output,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  } as Anthropic.Messages.Usage;
}

function testTokenBudget() {
  console.log("token budget");
  const b = new TurnBudget({ maxTokens: 1000 });
  b.add(MODELS.primary, usage(600, 0));
  assert(b.totalTokens === 600, "accumulates input+output tokens");
  assert(!b.exceeded(), "under budget after one round-trip");
  b.add(MODELS.primary, usage(600, 0));
  assert(b.totalTokens === 1200, "accumulates across round-trips");
  assert(b.exceeded(), "trips once the token ceiling is crossed");
}

function testCostBudget() {
  console.log("cost budget");
  const b = new TurnBudget({ maxCostUsd: 0.01 });
  // 1M input tokens on the primary (Opus) model is well past a 1-cent cap.
  b.add(MODELS.primary, usage(1_000_000, 0));
  assert(b.totalCostUsd > 0, "accumulates nonzero cost for a priced model");
  assert(b.exceeded(), "trips once the cost ceiling is crossed");
}

function testDefaultGenerous() {
  console.log("default budget");
  const b = new TurnBudget();
  // A normal multi-tool turn: a handful of round-trips, modest tokens.
  for (let i = 0; i < 6; i += 1) b.add(MODELS.primary, usage(8_000, 800));
  assert(
    !b.exceeded(),
    "a normal turn stays well under the generous default"
  );
  assert(
    DEFAULT_TURN_TOKEN_BUDGET > 100_000,
    "default is generous (interactive turns shouldn't trip it)"
  );
}

function testNullUsageIgnored() {
  console.log("null usage");
  const b = new TurnBudget({ maxTokens: 10 });
  b.add(MODELS.primary, null);
  b.add(MODELS.primary, undefined);
  assert(b.totalTokens === 0, "null/undefined usage is a no-op");
  assert(!b.exceeded(), "no spend → not exceeded");
}

function main() {
  console.log("per-turn budget guard\n");
  testTokenBudget();
  testCostBudget();
  testDefaultGenerous();
  testNullUsageIgnored();

  console.log(`\n${stats.pass} passed, ${stats.fail} failed`);
  if (stats.fail > 0) process.exit(1);
}

main();
