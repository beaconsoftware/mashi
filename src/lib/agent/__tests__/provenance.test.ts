/**
 * C1/C2 — unit tests for the output-trust derivations.
 *
 * Self-running assertion script (no test framework, matching the convention
 * in replay.test.ts / budget.test.ts). Runs with:
 *   pnpm test:provenance
 *
 * Covers the acceptance criteria:
 *   - C1: a result derived from a Slack/Gmail thread / board / linear yields a
 *     source descriptor (clickable when the row carries a URL).
 *   - C2: a search_board result summarizes to a readable list with titles, not
 *     a JSON blob; unknown tools return null so the caller falls back to raw.
 */
import {
  deriveSources,
  summarizeToolResult,
} from "@/lib/agent/provenance";

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

function testSourcesBoard() {
  console.log("deriveSources: board");
  const sources = deriveSources("search_board", {
    items: [
      { id: "1", ticket_number: "MASH-12", title: "Ship billing", source_url: "https://slack.com/x" },
      { id: "2", title: "No ticket", source_url: null },
    ],
    count: 2,
  });
  assert(sources.length === 2, "two item sources");
  assert(sources[0].kind === "item", "kind is item");
  assert(sources[0].title === "MASH-12 · Ship billing", "ticket-prefixed title");
  assert(sources[0].href === "https://slack.com/x", "carries source_url href");
  assert(sources[1].href === undefined, "no href when source_url missing");
}

function testSourcesLinearHasUrl() {
  console.log("deriveSources: linear");
  const sources = deriveSources("search_linear", {
    issues: [{ id: "i1", title: "Fix auth", url: "https://linear.app/x/issue/AB-1" }],
  });
  assert(sources.length === 1 && sources[0].kind === "linear", "one linear source");
  assert(sources[0].href === "https://linear.app/x/issue/AB-1", "linear url becomes href");
}

function testSourcesMessageThread() {
  console.log("deriveSources: message thread");
  const sources = deriveSources("get_message_thread", {
    messages: [
      { id: "m1", sender_name: "Debra", subject: "Re: SNA-114" },
      { id: "m2", sender_name: "Debra", subject: "Re: SNA-114" },
    ],
  });
  // both rows share subject → deduped to one chip
  assert(sources.length === 1, "duplicate subjects deduped");
  assert(sources[0].kind === "message", "kind is message");
  assert(sources[0].href === undefined, "messages have no permalink href");
}

function testSourcesEverythingDiscriminated() {
  console.log("deriveSources: search_everything");
  const sources = deriveSources("search_everything", {
    results: [
      { kind: "s2d_item", ticket_number: "MASH-1", title: "A" },
      { kind: "meeting", title: "Sync" },
      { kind: "linear_issue", title: "Bug", url: "https://linear.app/z" },
      { kind: "message", sender_name: "Maya" },
    ],
  });
  assert(sources.length === 4, "four discriminated sources");
  assert(sources.some((s) => s.kind === "meeting"), "meeting kind present");
  assert(
    sources.find((s) => s.kind === "linear")?.href === "https://linear.app/z",
    "linear href present"
  );
}

function testSourcesIgnoresUnknownAndErrors() {
  console.log("deriveSources: unknown + non-record");
  assert(deriveSources("send_email", { ok: true }).length === 0, "write tool yields no sources");
  assert(deriveSources("search_board", "not-json").length === 0, "non-record output is safe");
  assert(deriveSources("search_board", null).length === 0, "null output is safe");
}

function testSummaryBoardIsReadable() {
  console.log("summarizeToolResult: board");
  const summary = summarizeToolResult("search_board", {
    items: [
      { ticket_number: "MASH-12", title: "Ship billing", priority: "urgent", status: "open" },
      { ticket_number: "MASH-13", title: "Draft brief", status: "open" },
    ],
    count: 2,
  });
  assert(summary !== null, "board summary exists");
  assert(summary!.headline === "2 board items", "headline counts items");
  assert(summary!.rows[0].title === "MASH-12 · Ship billing", "row carries title not JSON");
  assert(summary!.rows[0].meta === "urgent · open", "row meta combines priority + status");
}

function testSummaryEmptyAndUnknown() {
  console.log("summarizeToolResult: empty + unknown");
  const empty = summarizeToolResult("search_messages", { messages: [], count: 0 });
  assert(empty!.headline === "No messages", "empty result reads cleanly");
  assert(summarizeToolResult("whoami", { user: "x" }) === null, "unknown tool returns null (raw fallback)");
  assert(summarizeToolResult("search_board", "blob") === null, "non-record returns null");
}

function main() {
  console.log("output-trust provenance + summaries\n");
  testSourcesBoard();
  testSourcesLinearHasUrl();
  testSourcesMessageThread();
  testSourcesEverythingDiscriminated();
  testSourcesIgnoresUnknownAndErrors();
  testSummaryBoardIsReadable();
  testSummaryEmptyAndUnknown();
  console.log(`\n${stats.pass} passed, ${stats.fail} failed`);
  if (stats.fail > 0) process.exit(1);
}

main();
