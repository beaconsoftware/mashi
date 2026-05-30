/**
 * P2.b — unit tests for the conversation-control core: the Regenerate /
 * Edit-and-resend guard (rerun.ts) and the thread export serializers
 * (transcript.ts).
 *
 * Self-running assertion script (matches replay.test.ts / budget.test.ts).
 * Runs with: pnpm test:transcript
 */
import {
  findLastUserMessage,
  findUserMessageById,
  firstCommittedWrite,
  planRerun,
  rowsAfterSeq,
  type RerunMessageRow,
} from "@/lib/agent/rerun";
import {
  exportFilename,
  threadToJSON,
  threadToMarkdown,
  type TranscriptMessage,
} from "@/lib/agent/transcript";
import type { ToolRing } from "@/lib/agent/types";

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

function row(
  partial: Partial<RerunMessageRow> & Pick<RerunMessageRow, "role" | "seq">
): RerunMessageRow {
  return {
    id: partial.id ?? `m${partial.seq}`,
    content: partial.content ?? null,
    tool_calls: partial.tool_calls ?? null,
    cursor_context: partial.cursor_context,
    ...partial,
  };
}

// A read-only ring map: every tool reads except the two named writers.
const ringOf = (name: string): ToolRing | undefined => {
  if (name === "send_email") return "write_world";
  if (name === "snooze_item") return "write_mashi";
  if (name === "search_board" || name === "get_item") return "read";
  return undefined; // unknown → non-blocking
};

function testAnchorLookup() {
  console.log("anchor lookup");
  const rows = [
    row({ role: "user", seq: 1, id: "u1" }),
    row({ role: "assistant", seq: 2, id: "a1" }),
    row({ role: "user", seq: 3, id: "u2" }),
    row({ role: "assistant", seq: 4, id: "a2" }),
  ];
  assert(findLastUserMessage(rows)?.id === "u2", "finds the last user message");
  assert(
    findUserMessageById(rows, "u1")?.id === "u1",
    "finds a user message by id"
  );
  assert(
    findUserMessageById(rows, "a1") === null,
    "rejects a non-user id (assistant)"
  );
  assert(findLastUserMessage([]) === null, "empty thread → no anchor");
}

function testRowsAfter() {
  console.log("segment selection");
  const rows = [
    row({ role: "user", seq: 1 }),
    row({ role: "assistant", seq: 2 }),
    row({ role: "tool", seq: 3 }),
    row({ role: "assistant", seq: 4 }),
  ];
  const after = rowsAfterSeq(rows, 1);
  assert(after.length === 3, "captures every row after the anchor seq");
  assert(rowsAfterSeq(rows, 4).length === 0, "nothing after the last row");
}

function testCommittedWriteDetection() {
  console.log("committed-write detection");
  const readOnly = [
    row({
      role: "assistant",
      seq: 2,
      tool_calls: [{ id: "t1", name: "search_board", input: {} }],
    }),
  ];
  assert(
    firstCommittedWrite(readOnly, ringOf) === null,
    "read-only segment is safe to discard"
  );
  const wroteWorld = [
    row({
      role: "assistant",
      seq: 2,
      tool_calls: [{ id: "t1", name: "send_email", input: {} }],
    }),
  ];
  assert(
    firstCommittedWrite(wroteWorld, ringOf)?.tool === "send_email",
    "flags a ring-3 world write"
  );
  const wroteMashi = [
    row({
      role: "assistant",
      seq: 2,
      tool_calls: [{ id: "t1", name: "snooze_item", input: {} }],
    }),
  ];
  assert(
    firstCommittedWrite(wroteMashi, ringOf)?.tool === "snooze_item",
    "flags a ring-2 board write"
  );
  const unknown = [
    row({
      role: "assistant",
      seq: 2,
      tool_calls: [{ id: "t1", name: "mystery_tool", input: {} }],
    }),
  ];
  assert(
    firstCommittedWrite(unknown, ringOf) === null,
    "unknown tool is non-blocking"
  );
}

function testPlanRerun() {
  console.log("planRerun");
  const safe = [
    row({ role: "user", seq: 1, id: "u1" }),
    row({ role: "user", seq: 3, id: "u2" }),
    row({
      role: "assistant",
      seq: 4,
      tool_calls: [{ id: "t1", name: "search_board", input: {} }],
    }),
    row({ role: "assistant", seq: 5, content: "here's what I found" }),
  ];
  const plan = planRerun(safe, { mode: "last" }, ringOf);
  assert(plan.ok === true, "regenerate a read-only last turn is allowed");
  if (plan.ok) {
    assert(plan.anchor.id === "u2", "anchors on the last user message");
    assert(plan.discarded.length === 2, "discards the two trailing rows");
  }

  const wrote = [
    row({ role: "user", seq: 1, id: "u1" }),
    row({
      role: "assistant",
      seq: 2,
      tool_calls: [{ id: "t1", name: "send_email", input: {} }],
    }),
  ];
  const blocked = planRerun(wrote, { mode: "last" }, ringOf);
  assert(
    !blocked.ok && blocked.reason === "committed_write",
    "blocks regenerate when the discarded turn sent an email"
  );
  assert(
    !blocked.ok && blocked.tool === "send_email",
    "surfaces which tool committed the write"
  );

  const editTarget = planRerun(
    safe,
    { mode: "message", messageId: "u1" },
    ringOf
  );
  assert(
    editTarget.ok === true && editTarget.anchor.id === "u1",
    "edit anchors on the targeted user message"
  );
  if (editTarget.ok) {
    assert(
      editTarget.discarded.length === 3,
      "edit discards everything after the edited message"
    );
  }

  const noAnchor = planRerun([], { mode: "last" }, ringOf);
  assert(
    !noAnchor.ok && noAnchor.reason === "no_anchor",
    "empty thread → no_anchor"
  );
}

function testMarkdownExport() {
  console.log("markdown export");
  const msgs: TranscriptMessage[] = [
    { role: "user", content: "what's on my plate?" },
    {
      role: "assistant",
      content: "checking the board",
      tool_calls: [{ id: "t1", name: "search_board", input: {} }],
    },
    {
      role: "tool",
      content: null,
      tool_results: [{ tool_use_id: "t1", content: "[]", is_error: false }],
    },
    { role: "assistant", content: "you have 3 items due today" },
  ];
  const md = threadToMarkdown(
    { id: "th1", title: "Today's plan", created_at: null },
    msgs
  );
  assert(md.includes("# Today's plan"), "includes the title heading");
  assert(md.includes("**You:** what's on my plate?"), "renders the user turn");
  assert(
    md.includes("**Mashi:** you have 3 items due today"),
    "renders the assistant answer"
  );
  assert(md.includes("_used: search_board_"), "notes tools used");
  assert(!md.includes("tool_use_id"), "tool-result rows are folded away");
}

function testJSONExport() {
  console.log("json export");
  const msgs: TranscriptMessage[] = [
    { role: "user", content: "hi" },
    { role: "assistant", content: "hey" },
  ];
  const json = threadToJSON({ id: "th1", title: "Greeting" }, msgs);
  const parsed = JSON.parse(json) as {
    thread: { id: string; title: string };
    messages: Array<{ role: string; content: string | null }>;
  };
  assert(parsed.thread.id === "th1", "JSON carries the thread id");
  assert(parsed.messages.length === 2, "JSON carries every message");
  assert(parsed.messages[0].role === "user", "JSON preserves roles");
}

function testFilename() {
  console.log("export filename");
  assert(
    exportFilename({ id: "x", title: "MASH-42, Brand spend" }, "md") ===
      "mash-42-brand-spend.md",
    "slugifies the title with the extension"
  );
  assert(
    exportFilename({ id: "x", title: "" }, "json") ===
      "mashi-conversation.json",
    "falls back to a default for an empty title"
  );
}

function main() {
  console.log("conversation control (D2/D3/D4)\n");
  testAnchorLookup();
  testRowsAfter();
  testCommittedWriteDetection();
  testPlanRerun();
  testMarkdownExport();
  testJSONExport();
  testFilename();

  console.log(`\n${stats.pass} passed, ${stats.fail} failed`);
  if (stats.fail > 0) process.exit(1);
}

main();
