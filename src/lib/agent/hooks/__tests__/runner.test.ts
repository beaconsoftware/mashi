/**
 * Quality Phase 4 — unit tests for the hook runners.
 *
 * Self-running assertion script. Runs with:
 *   pnpm test:hooks
 *
 * No third-party test framework — Mashi doesn't ship one and adding
 * Vitest just for these handful of tests is overkill. The assertion
 * helper logs failures + counts and exits non-zero so CI catches
 * regressions.
 *
 * Covers, per the Phase 4 spec:
 *   - empty chain
 *   - allow chain
 *   - deny short-circuits
 *   - ask short-circuits
 *   - transform chains into the next hook
 *   - multiple hooks in sequence
 *   - postTool: empty chain + multi-hook execution
 *   - postTool: a thrown hook doesn't break the chain
 */
import {
  runPostToolHooks,
  runPreToolHooks,
} from "@/lib/agent/hooks/runner";
import type {
  HookDecision,
  PostToolUseHook,
  PreToolUseHook,
} from "@/lib/agent/hooks/types";
import type { ToolContext, ToolRing } from "@/lib/agent/types";

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

function assertEqual<T>(actual: T, expected: T, label: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    stats.pass += 1;
    console.log(`  ✓ ${label}`);
  } else {
    stats.fail += 1;
    console.error(`  ✗ ${label}\n    expected ${e}\n    actual   ${a}`);
  }
}

const ctx = {
  userId: "u1",
  // Avoid pulling in the real supabase client in a pure-logic test.
  supabase: null as unknown,
  origin: "session",
  threadId: "t1",
} as unknown as ToolContext;

function preHook(
  name: string,
  matches: (toolName: string, ring: ToolRing) => boolean,
  decision: HookDecision | (() => HookDecision)
): PreToolUseHook {
  return {
    name,
    matches,
    async run() {
      return typeof decision === "function" ? decision() : decision;
    },
  };
}

function postHook(
  name: string,
  matches: (toolName: string, ring: ToolRing) => boolean,
  body: (calls: string[]) => Promise<void>,
  log: string[]
): PostToolUseHook {
  return {
    name,
    matches,
    async run() {
      await body(log);
    },
  };
}

async function testEmptyPreChain() {
  console.log("\nempty pre chain");
  const r = await runPreToolHooks({
    toolName: "snooze_item",
    input: { id: "x" },
    ring: "write_mashi",
    ctx,
    callId: "c1",
    hooks: [],
  });
  assertEqual(r.decision.decision, "allow", "decision is allow");
  assertEqual(r.effectiveInput, { id: "x" }, "input passes through unchanged");
  assertEqual(r.effectiveToolName, "snooze_item", "toolName unchanged");
}

async function testAllowChain() {
  console.log("\nall-allow chain");
  const h1 = preHook("a", () => true, { decision: "allow" });
  const h2 = preHook("b", () => true, { decision: "allow" });
  const r = await runPreToolHooks({
    toolName: "snooze_item",
    input: 1,
    ring: "write_mashi",
    ctx,
    callId: "c1",
    hooks: [h1, h2],
  });
  assertEqual(r.decision.decision, "allow", "decision is allow");
  assertEqual(r.effectiveInput, 1, "input unchanged");
}

async function testDenyShortCircuits() {
  console.log("\ndeny short-circuits");
  let reached = false;
  const h1 = preHook("a", () => true, {
    decision: "deny",
    message: "nope",
  });
  const h2: PreToolUseHook = {
    name: "b",
    matches: () => true,
    async run() {
      reached = true;
      return { decision: "allow" };
    },
  };
  const r = await runPreToolHooks({
    toolName: "snooze_item",
    input: 1,
    ring: "write_mashi",
    ctx,
    callId: "c1",
    hooks: [h1, h2],
  });
  assertEqual(r.decision.decision, "deny", "decision is deny");
  assert(!reached, "second hook is not invoked");
}

async function testAskShortCircuits() {
  console.log("\nask short-circuits");
  let reached = false;
  const h1 = preHook("a", () => true, {
    decision: "ask",
    message: "which one?",
  });
  const h2: PreToolUseHook = {
    name: "b",
    matches: () => true,
    async run() {
      reached = true;
      return { decision: "allow" };
    },
  };
  const r = await runPreToolHooks({
    toolName: "snooze_item",
    input: 1,
    ring: "write_mashi",
    ctx,
    callId: "c1",
    hooks: [h1, h2],
  });
  assertEqual(r.decision.decision, "ask", "decision is ask");
  assert(!reached, "second hook is not invoked");
}

async function testTransformChainsForward() {
  console.log("\ntransform chains into the next hook");
  const seen: unknown[] = [];
  const h1 = preHook("a", () => true, {
    decision: "transform",
    input: { rewritten: true },
    rationale: "test rewrite",
  });
  const h2: PreToolUseHook = {
    name: "b",
    matches: () => true,
    async run(o) {
      seen.push(o.input);
      return { decision: "allow" };
    },
  };
  const r = await runPreToolHooks({
    toolName: "create_item",
    input: { rewritten: false },
    ring: "write_mashi",
    ctx,
    callId: "c1",
    hooks: [h1, h2],
  });
  assertEqual(seen[0], { rewritten: true }, "second hook sees transformed input");
  assertEqual(r.effectiveInput, { rewritten: true }, "effective input is rewritten");
  assertEqual(r.decision.decision, "allow", "final decision is allow");
}

async function testTransformWithToolNameRedirect() {
  console.log("\ntransform with toolName swap");
  const r = await runPreToolHooks({
    toolName: "create_item",
    input: { title: "x" },
    ring: "write_mashi",
    ctx,
    callId: "c1",
    hooks: [
      preHook("redirect", () => true, {
        decision: "transform",
        toolName: "update_item",
        input: { id: "abc" },
        rationale: "matched existing",
      }),
    ],
  });
  assertEqual(r.effectiveToolName, "update_item", "tool name swapped");
  assertEqual(r.effectiveInput, { id: "abc" }, "input rewritten");
}

async function testMultiHookSequence() {
  console.log("\nmultiple hooks in sequence");
  const seq: string[] = [];
  const h1: PreToolUseHook = {
    name: "h1",
    matches: () => true,
    async run() {
      seq.push("h1");
      return { decision: "allow" };
    },
  };
  const h2: PreToolUseHook = {
    name: "h2",
    matches: () => true,
    async run() {
      seq.push("h2");
      return { decision: "allow" };
    },
  };
  const h3: PreToolUseHook = {
    name: "h3",
    matches: () => true,
    async run() {
      seq.push("h3");
      return { decision: "allow" };
    },
  };
  await runPreToolHooks({
    toolName: "x",
    input: null,
    ring: "read",
    ctx,
    callId: "c1",
    hooks: [h1, h2, h3],
  });
  assertEqual(seq, ["h1", "h2", "h3"], "hooks ran in declaration order");
}

async function testHookMatchPredicate() {
  console.log("\nmatches predicate filters hooks");
  const seq: string[] = [];
  const h1: PreToolUseHook = {
    name: "h1",
    matches: (name) => name === "yes",
    async run() {
      seq.push("h1");
      return { decision: "allow" };
    },
  };
  const h2: PreToolUseHook = {
    name: "h2",
    matches: (name) => name === "no",
    async run() {
      seq.push("h2");
      return { decision: "allow" };
    },
  };
  await runPreToolHooks({
    toolName: "yes",
    input: null,
    ring: "read",
    ctx,
    callId: "c1",
    hooks: [h1, h2],
  });
  assertEqual(seq, ["h1"], "only matching hook ran");
}

async function testEmptyPostChain() {
  console.log("\nempty post chain");
  await runPostToolHooks({
    toolName: "x",
    input: null,
    result: { ok: true },
    ok: true,
    ring: "write_mashi",
    ctx,
    hooks: [],
  });
  assert(true, "completes without error");
}

async function testPostMultiHook() {
  console.log("\npost: multi-hook execution");
  const log: string[] = [];
  const h1 = postHook(
    "h1",
    () => true,
    async (l) => {
      l.push("h1");
    },
    log
  );
  const h2 = postHook(
    "h2",
    () => true,
    async (l) => {
      l.push("h2");
    },
    log
  );
  await runPostToolHooks({
    toolName: "x",
    input: null,
    result: { ok: true },
    ok: true,
    ring: "write_mashi",
    ctx,
    hooks: [h1, h2],
  });
  assertEqual(log, ["h1", "h2"], "post hooks ran in order");
}

async function testPostHookFailureIsSwallowed() {
  console.log("\npost: a thrown hook doesn't break the chain");
  const log: string[] = [];
  const h1: PostToolUseHook = {
    name: "boom",
    matches: () => true,
    async run() {
      throw new Error("boom");
    },
  };
  const h2 = postHook(
    "after",
    () => true,
    async (l) => {
      l.push("ran");
    },
    log
  );
  await runPostToolHooks({
    toolName: "x",
    input: null,
    result: { ok: true },
    ok: true,
    ring: "write_mashi",
    ctx,
    hooks: [h1, h2],
  });
  assertEqual(log, ["ran"], "hook after a thrown one still runs");
}

async function main() {
  await testEmptyPreChain();
  await testAllowChain();
  await testDenyShortCircuits();
  await testAskShortCircuits();
  await testTransformChainsForward();
  await testTransformWithToolNameRedirect();
  await testMultiHookSequence();
  await testHookMatchPredicate();
  await testEmptyPostChain();
  await testPostMultiHook();
  await testPostHookFailureIsSwallowed();

  console.log(`\n${stats.pass} passed, ${stats.fail} failed`);
  if (stats.fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
