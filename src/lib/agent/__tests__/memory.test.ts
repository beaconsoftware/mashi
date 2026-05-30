/**
 * P6.a (Epic F1) — unit tests for the pure MASHI.md memory-append module.
 *
 * Self-running assertion script (no framework, matching approval-meta.test.ts /
 * references.test.ts). Runs with:
 *   pnpm test:memory
 *
 * Covers the testable slice of the F1 acceptance criteria:
 *   - normalizeFact collapses a fact into one clean bullet-able line
 *   - buildMemoryAppend appends as a new bullet, preserving existing content
 *   - the 8000-char cap is enforced (over-cap → ok:false, content unchanged)
 *   - near-limit is flagged so the tool can offer to consolidate
 */
import {
  buildMemoryAppend,
  normalizeFact,
  MASHI_MD_MAX_CHARS,
} from "@/lib/agent/memory";

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

function testNormalize() {
  console.log("normalizeFact");
  assert(normalizeFact("  hello  world ") === "hello world", "trims + collapses whitespace");
  assert(normalizeFact("line one\nline two") === "line one line two", "newlines collapse to spaces");
  assert(normalizeFact("- already a bullet") === "already a bullet", "leading dash bullet stripped");
  assert(normalizeFact("* star bullet") === "star bullet", "leading star bullet stripped");
  assert(normalizeFact("   ") === "", "whitespace-only → empty");
}

function testAppendEmpty() {
  console.log("buildMemoryAppend onto empty file");
  const r = buildMemoryAppend("", "Prefers bullets");
  assert(r.ok, "ok on empty file");
  assert(r.next === "- Prefers bullets", "single bullet, no leading newline");
  assert(r.length === r.next.length, "length matches next");
  assert(r.nearLimit === false, "not near limit");
}

function testAppendExisting() {
  console.log("buildMemoryAppend onto existing content");
  const current = "# Memory\n- Existing fact";
  const r = buildMemoryAppend(current, "New fact");
  assert(r.ok, "ok");
  assert(r.next === "# Memory\n- Existing fact\n- New fact", "appends as new bullet line");
  assert(r.next.startsWith(current), "preserves existing content verbatim");
}

function testTrailingWhitespace() {
  console.log("buildMemoryAppend trims trailing whitespace before appending");
  const r = buildMemoryAppend("- one\n\n\n", "two");
  assert(r.next === "- one\n- two", "collapses trailing blank lines, then appends");
}

function testEmptyFactRejected() {
  console.log("buildMemoryAppend rejects an empty fact");
  const r = buildMemoryAppend("- one", "   ");
  assert(!r.ok, "ok:false for whitespace-only fact");
  assert(r.next === "- one", "content unchanged");
  assert(typeof r.error === "string" && r.error.length > 0, "carries an error reason");
}

function testCapEnforced() {
  console.log("buildMemoryAppend enforces the char cap");
  const cap = 50;
  const current = "x".repeat(45);
  const r = buildMemoryAppend(current, "this fact pushes well over the tiny cap", cap);
  assert(!r.ok, "ok:false when over cap");
  assert(r.next === current, "content unchanged on rejection");
  assert(r.length > cap, "reports the would-be length");
  assert(r.nearLimit === true, "over-cap is flagged near limit");
  assert(
    typeof r.error === "string" && /consolidate|limit/i.test(r.error),
    "error nudges toward consolidation"
  );
}

function testNearLimit() {
  console.log("buildMemoryAppend flags near-limit but still appends");
  const cap = 100;
  const current = "y".repeat(88); // 88 + "\n- ok" = 93 >= 90% of 100
  const r = buildMemoryAppend(current, "ok", cap);
  assert(r.ok, "still ok under the cap");
  assert(r.nearLimit === true, "flagged near limit at >=90%");
}

function testRealCap() {
  console.log("default cap mirrors the route");
  assert(MASHI_MD_MAX_CHARS === 8000, "cap is 8000");
  const r = buildMemoryAppend("z".repeat(7999), "overflow");
  assert(!r.ok, "8000-char file + a fact is rejected at default cap");
}

console.log("\n=== memory.test.ts ===\n");
testNormalize();
testAppendEmpty();
testAppendExisting();
testTrailingWhitespace();
testEmptyFactRejected();
testCapEnforced();
testNearLimit();
testRealCap();

console.log(`\n${stats.pass} passed, ${stats.fail} failed\n`);
if (stats.fail > 0) process.exit(1);
