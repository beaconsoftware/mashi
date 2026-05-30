/**
 * P4.a (Epic E2 + E3) — unit tests for the pure approval-meta module.
 *
 * Self-running assertion script (no framework, matching references.test.ts /
 * attachments.test.ts). Runs with:
 *   pnpm test:approval-meta
 *
 * Covers the testable slice of the acceptance criteria:
 *   - approvalMetaFor classifies sends vs drafts vs updates distinctly, and
 *     falls back sanely for an unknown ring-3 tool
 *   - buildDiffRows pairs a proposed patch against the before-snapshot and
 *     flags only the genuinely changed fields (E2: old vs new per field)
 *   - flattenEditable reaches nested object + array-element scalars (E3: an
 *     array arg / nested patch is editable, not dropped)
 *   - applyEdits round-trips edits back into the nested shape and coerces
 *     numbers / booleans to their original type
 *   - isCancelledResult / isExpiredResult detect the neutral-outcome markers
 *     (E3: a cancelled write reads as cancelled, not error)
 */
import {
  applyEdits,
  approvalMetaFor,
  buildDiffRows,
  flattenEditable,
  isCancelledResult,
  isExpiredResult,
  isPolicyControlled,
  listApprovalToolNames,
  type EditableLeaf,
} from "@/lib/agent/approval-meta";
import { isAlwaysAllowEligible } from "@/lib/agent/policy";

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

function testMeta() {
  console.log("approvalMetaFor");
  const send = approvalMetaFor("send_email");
  assert(send.weight === "send", "send_email → weight send");
  assert(send.reversible === false, "send_email is not reversible");
  assert(send.isUpdate === false, "send_email is not an update");

  const draft = approvalMetaFor("draft_email");
  assert(draft.weight === "reversible", "draft_email → weight reversible");
  assert(draft.reversible === true, "draft_email is reversible");
  assert(
    draft.weight !== send.weight,
    "draft and send carry distinct weight"
  );

  const update = approvalMetaFor("update_linear_issue");
  assert(update.weight === "external", "update_linear_issue → external");
  assert(update.isUpdate === true, "update_linear_issue is an update");

  const unknown = approvalMetaFor("some_new_ring3_tool");
  assert(unknown.weight === "external", "unknown tool falls back to external");
  assert(
    unknown.primaryLabel === "Approve",
    "unknown tool gets a generic Approve label"
  );
  assert(unknown.noun === "some_new_ring3_tool", "unknown noun is the name");
}

function testDiff() {
  console.log("buildDiffRows");
  const before = { title: "Old title", priority: 2, state_id: "s-1" };
  const patch = { title: "New title", priority: 2 };
  const rows = buildDiffRows(before, patch);
  assert(rows.length === 2, "one row per patched field (not per before key)");
  const title = rows.find((r) => r.field === "title")!;
  assert(title.before === "Old title", "title before captured");
  assert(title.after === "New title", "title after captured");
  assert(title.changed === true, "changed title flagged changed");
  const prio = rows.find((r) => r.field === "priority")!;
  assert(prio.before === "2" && prio.after === "2", "priority unchanged values");
  assert(prio.changed === false, "unchanged priority not flagged");

  const noBefore = buildDiffRows(undefined, { title: "X" });
  assert(noBefore[0].before === "", "missing before snapshot → empty string");
  assert(noBefore[0].changed === true, "new value over empty counts as change");
}

function testFlatten() {
  console.log("flattenEditable");
  const args = {
    id: "abc",
    patch: { title: "Hi", priority: 3 },
    attendees: ["a@x.com", "b@x.com"],
  };
  const leaves = flattenEditable(args);
  const keys = leaves.map((l) => l.key).sort();
  assert(keys.includes("id"), "top-level scalar reached");
  assert(keys.includes("patch.title"), "nested object scalar reached");
  assert(keys.includes("patch.priority"), "nested numeric scalar reached");
  assert(keys.includes("attendees.0"), "array element 0 reached");
  assert(keys.includes("attendees.1"), "array element 1 reached");
  const prio = leaves.find((l) => l.key === "patch.priority")!;
  assert(prio.type === "number", "numeric leaf typed number");
  const longBody = flattenEditable({ body: "x".repeat(120) });
  assert(longBody[0].kind === "long", "long string → long editor");
  const namedBody = flattenEditable({ body: "short" });
  assert(namedBody[0].kind === "long", "body field → long editor by name");
  const subj = flattenEditable({ subject: "short" });
  assert(subj[0].kind === "text", "short non-body → single-line editor");
}

function testApplyEdits() {
  console.log("applyEdits");
  const original = {
    id: "abc",
    patch: { title: "Hi", priority: 3 },
    attendees: ["a@x.com", "b@x.com"],
    flag: true,
  };
  const leaves: EditableLeaf[] = flattenEditable(original);
  const edits = {
    "patch.title": "Updated",
    "patch.priority": "1",
    "attendees.1": "c@x.com",
    flag: "false",
  };
  const out = applyEdits(original, edits, leaves) as typeof original;
  assert(out.patch.title === "Updated", "nested string edit applied");
  assert(out.patch.priority === 1, "numeric leaf coerced back to number");
  assert(typeof out.patch.priority === "number", "priority stays a number");
  assert(out.attendees[1] === "c@x.com", "array element edited");
  assert(out.attendees[0] === "a@x.com", "untouched array element preserved");
  assert(out.flag === false, "boolean leaf coerced back to boolean");
  assert(out.id === "abc", "untouched scalar preserved");
  // Original is not mutated.
  assert(original.patch.title === "Hi", "applyEdits does not mutate original");
}

function testCancelMarkers() {
  console.log("isCancelledResult / isExpiredResult");
  assert(
    isCancelledResult({ ok: false, error: "user cancelled", cancelled: true }),
    "cancelled marker detected"
  );
  assert(!isCancelledResult({ ok: false, error: "boom" }), "plain error is not cancelled");
  assert(!isCancelledResult("a string"), "string result is not cancelled");
  assert(!isCancelledResult(null), "null is not cancelled");
  assert(
    isExpiredResult({ ok: false, error: "approval window expired", expired: true }),
    "expired marker detected"
  );
  assert(!isExpiredResult({ cancelled: true }), "cancelled is not expired");
}

function testPolicyControl() {
  console.log("isPolicyControlled / listApprovalToolNames (F1)");
  // propose_memory: a light, reversible confirm that is never policy-bypassable.
  const mem = approvalMetaFor("propose_memory");
  assert(mem.weight === "reversible", "propose_memory → weight reversible (light)");
  assert(mem.reversible === true, "propose_memory is reversible");
  assert(
    isPolicyControlled("propose_memory") === false,
    "propose_memory is NOT policy-controlled"
  );
  assert(
    !listApprovalToolNames().includes("propose_memory"),
    "propose_memory excluded from the policy UI tool list"
  );
  // It must therefore show no inline always-allow toggle even though its
  // weight (reversible) would otherwise be eligible.
  assert(
    isAlwaysAllowEligible("propose_memory") &&
      !(isAlwaysAllowEligible("propose_memory") && isPolicyControlled("propose_memory")),
    "eligible by weight, but the card's canRemember resolves false"
  );
  // Existing ring-3 tools stay policy-controlled and in the list.
  assert(isPolicyControlled("send_email"), "send_email stays policy-controlled");
  assert(
    listApprovalToolNames().includes("send_email"),
    "send_email still in the policy UI list"
  );
  // Unknown tools default to policy-controlled (a generic ring-3 tool earns one).
  assert(
    isPolicyControlled("some_new_ring3_tool"),
    "unknown tool defaults to policy-controlled"
  );
}

console.log("\n=== approval-meta.test.ts ===\n");
testMeta();
testDiff();
testFlatten();
testApplyEdits();
testCancelMarkers();
testPolicyControl();

console.log(`\n${stats.pass} passed, ${stats.fail} failed\n`);
if (stats.fail > 0) process.exit(1);
