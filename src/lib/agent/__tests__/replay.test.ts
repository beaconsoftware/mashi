/**
 * A1 — unit tests for turn replay reconstruction + defensive tool_use
 * pairing.
 *
 * Self-running assertion script (no test framework, matching the
 * convention in hooks/__tests__/runner.test.ts). Runs with:
 *   pnpm test:replay
 *
 * Covers the A1 acceptance criterion "a synthetic orphaned tool_use row
 * is tolerated by replay", plus the happy paths so the pairing pass
 * never corrupts a well-formed history.
 */
import { messagesToReplay, ensureToolResultsPaired } from "@/lib/agent/replay";

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

type Block = { type: string; id?: string; tool_use_id?: string };

function assistantToolUseRow(id: string, name = "search_board") {
  return {
    role: "assistant",
    content: "looking that up",
    tool_calls: [{ id, name, input: { q: "x" } }],
    tool_results: null,
  };
}

function toolResultRow(ids: string[]) {
  return {
    role: "tool",
    content: null,
    tool_calls: null,
    tool_results: ids.map((id) => ({
      tool_use_id: id,
      content: JSON.stringify({ ok: true }),
      is_error: false,
    })),
  };
}

/** Pull every tool_result tool_use_id out of a rebuilt message list. */
function answeredIds(blocks: ReturnType<typeof messagesToReplay>): Set<string> {
  const ids = new Set<string>();
  for (const b of blocks) {
    if (b.role !== "user" || !Array.isArray(b.content)) continue;
    for (const block of b.content as Block[]) {
      if (block.type === "tool_result" && block.tool_use_id) {
        ids.add(block.tool_use_id);
      }
    }
  }
  return ids;
}

function toolUseIds(blocks: ReturnType<typeof messagesToReplay>): Set<string> {
  const ids = new Set<string>();
  for (const b of blocks) {
    if (b.role !== "assistant" || !Array.isArray(b.content)) continue;
    for (const block of b.content as Block[]) {
      if (block.type === "tool_use" && block.id) ids.add(block.id);
    }
  }
  return ids;
}

function testWellFormedTurnUnchanged() {
  console.log("well-formed turn: every tool_use is answered, no synthesis");
  const rows = [
    { role: "user", content: "find the brand thing", tool_calls: null, tool_results: null },
    assistantToolUseRow("tu_1"),
    toolResultRow(["tu_1"]),
    { role: "assistant", content: "here it is", tool_calls: null, tool_results: null },
  ];
  const replay = messagesToReplay(rows);
  const uses = toolUseIds(replay);
  const answered = answeredIds(replay);
  assert(uses.has("tu_1") && answered.has("tu_1"), "tu_1 present and answered");
  // No extra synthetic results were added (exactly one tool_result block).
  const resultCount = replay
    .filter((b) => b.role === "user" && Array.isArray(b.content))
    .flatMap((b) => b.content as Block[])
    .filter((b) => b.type === "tool_result").length;
  assert(resultCount === 1, "no synthetic result added to a paired turn");
}

function testOrphanToolUseToleratedNoFollowingTurn() {
  console.log("orphaned tool_use, no tool row at all (crash before result)");
  const rows = [
    { role: "user", content: "do the thing", tool_calls: null, tool_results: null },
    assistantToolUseRow("tu_orphan"),
    // crash: no tool-result row was ever written.
  ];
  const replay = messagesToReplay(rows);
  const answered = answeredIds(replay);
  assert(answered.has("tu_orphan"), "synthetic tool_result paired the orphan");
  // The synthetic result must come AFTER the assistant tool_use block.
  const assistantIdx = replay.findIndex(
    (b) => b.role === "assistant" && Array.isArray(b.content)
  );
  const resultIdx = replay.findIndex(
    (b) =>
      b.role === "user" &&
      Array.isArray(b.content) &&
      (b.content as Block[]).some((x) => x.type === "tool_result")
  );
  assert(resultIdx > assistantIdx, "synthetic result follows the tool_use");
}

function testPartialPairingFillsOnlyMissing() {
  console.log("two tool_use, only one answered → fill the missing one");
  const rows = [
    {
      role: "assistant",
      content: null,
      tool_calls: [
        { id: "tu_a", name: "search_board", input: {} },
        { id: "tu_b", name: "get_item", input: {} },
      ],
      tool_results: null,
    },
    toolResultRow(["tu_a"]), // tu_b is missing
  ];
  const replay = messagesToReplay(rows);
  const answered = answeredIds(replay);
  assert(answered.has("tu_a") && answered.has("tu_b"), "both ids answered");
  // Both results should live in a single user turn (spliced), not two.
  const resultTurns = replay.filter(
    (b) =>
      b.role === "user" &&
      Array.isArray(b.content) &&
      (b.content as Block[]).some((x) => x.type === "tool_result")
  );
  assert(resultTurns.length === 1, "synthetic result spliced into existing turn");
}

function testOrphanFollowedByUserText() {
  console.log("orphaned tool_use followed by a plain user message");
  const rows = [
    assistantToolUseRow("tu_x"),
    { role: "user", content: "actually never mind", tool_calls: null, tool_results: null },
  ];
  const replay = messagesToReplay(rows);
  const answered = answeredIds(replay);
  assert(answered.has("tu_x"), "synthetic result inserted before user text");
  // Order: assistant(tool_use) → synthetic tool_result → user text.
  const roles = replay.map((b) => b.role);
  const aIdx = replay.findIndex(
    (b) => b.role === "assistant" && Array.isArray(b.content)
  );
  const rIdx = replay.findIndex(
    (b) =>
      b.role === "user" &&
      Array.isArray(b.content) &&
      (b.content as Block[]).some((x) => x.type === "tool_result")
  );
  const textIdx = replay.findIndex(
    (b) => b.role === "user" && typeof b.content === "string"
  );
  assert(aIdx < rIdx && rIdx < textIdx, `ordering correct (${roles.join(",")})`);
}

function testEmptyAndPureText() {
  console.log("empty + text-only lists are passthrough");
  assert(ensureToolResultsPaired([]).length === 0, "empty stays empty");
  const textOnly = messagesToReplay([
    { role: "user", content: "hi", tool_calls: null, tool_results: null },
    { role: "assistant", content: "hey", tool_calls: null, tool_results: null },
  ]);
  assert(textOnly.length === 2, "text-only turns untouched");
}

function main() {
  console.log("replay reconstruction + defensive pairing\n");
  testWellFormedTurnUnchanged();
  testOrphanToolUseToleratedNoFollowingTurn();
  testPartialPairingFillsOnlyMissing();
  testOrphanFollowedByUserText();
  testEmptyAndPureText();

  console.log(`\n${stats.pass} passed, ${stats.fail} failed`);
  if (stats.fail > 0) process.exit(1);
}

main();
