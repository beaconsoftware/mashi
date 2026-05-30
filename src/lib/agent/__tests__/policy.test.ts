/**
 * P4.b (Epic E1 + E5) — unit tests for the pure per-tool policy module.
 *
 * Self-running assertion script (no framework, matching approval-meta.test.ts
 * / references.test.ts). Runs with:
 *   pnpm test:policy
 *
 * Covers the testable slice of the acceptance criteria:
 *   - isAlwaysAllowEligible: irreversible sends are NOT eligible (E5 / privacy
 *     doctrine), reversible / external actions are
 *   - scopeForCall derives a narrow per-call scope key (channel / recipient)
 *   - resolvePolicy: exact scope beats wildcard beats the "ask" default
 *   - effectiveDecision: an always_allow on an ineligible send is downgraded
 *     to ask (defence in depth), while ask / never pass through
 *   - rememberScopeLabel / describeScope render the scope for the UI
 */
import {
  WILDCARD_SCOPE,
  describeScope,
  effectiveDecision,
  isAlwaysAllowEligible,
  rememberScopeLabel,
  resolvePolicy,
  scopeForCall,
  type ToolPolicy,
} from "@/lib/agent/policy";

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

function testEligibility() {
  console.log("isAlwaysAllowEligible");
  assert(
    isAlwaysAllowEligible("send_email") === false,
    "send_email is NOT always-allow eligible (irreversible send)"
  );
  assert(
    isAlwaysAllowEligible("send_slack_message") === false,
    "send_slack_message is NOT eligible"
  );
  assert(
    isAlwaysAllowEligible("comment_on_linear_issue") === false,
    "comment_on_linear_issue is NOT eligible"
  );
  assert(
    isAlwaysAllowEligible("draft_email") === true,
    "draft_email IS eligible (reversible) — E5"
  );
  assert(
    isAlwaysAllowEligible("react_with_emoji") === true,
    "react_with_emoji IS eligible (reversible) — E5"
  );
  assert(
    isAlwaysAllowEligible("create_calendar_event") === true,
    "create_calendar_event IS eligible (external, recallable)"
  );
}

function testScope() {
  console.log("scopeForCall");
  assert(
    scopeForCall("react_with_emoji", { channel: "C0123", ts: "1", emoji: "x" }) ===
      "channel:C0123",
    "react scopes by channel"
  );
  assert(
    scopeForCall("send_slack_message", { channel: "C9", body: "hi" }) ===
      "channel:C9",
    "slack send scopes by channel"
  );
  assert(
    scopeForCall("send_email", { to: "Maya@Portco.com", subject: "x", body: "y" }) ===
      "to:maya@portco.com",
    "email scopes by lowercased recipient"
  );
  assert(
    scopeForCall("create_linear_issue", { title: "x", team_id: "t" }) ===
      WILDCARD_SCOPE,
    "unscoped tool returns wildcard"
  );
  assert(
    scopeForCall("react_with_emoji", {}) === WILDCARD_SCOPE,
    "missing channel falls back to wildcard"
  );
}

function testResolve() {
  console.log("resolvePolicy");
  const policies: ToolPolicy[] = [
    { tool_name: "react_with_emoji", scope: WILDCARD_SCOPE, mode: "ask" },
    { tool_name: "react_with_emoji", scope: "channel:C9", mode: "always_allow" },
    { tool_name: "draft_email", scope: WILDCARD_SCOPE, mode: "always_allow" },
  ];
  assert(
    resolvePolicy(policies, "react_with_emoji", "channel:C9") === "always_allow",
    "exact scope beats wildcard"
  );
  assert(
    resolvePolicy(policies, "react_with_emoji", "channel:OTHER") === "ask",
    "non-matching scope falls back to the tool's wildcard"
  );
  assert(
    resolvePolicy(policies, "draft_email", "to:a@b.com") === "always_allow",
    "wildcard applies to any scope"
  );
  assert(
    resolvePolicy(policies, "create_calendar_event", WILDCARD_SCOPE) === "ask",
    "no rule → ask default"
  );
}

function testEffective() {
  console.log("effectiveDecision");
  const sendAllow: ToolPolicy[] = [
    { tool_name: "send_email", scope: WILDCARD_SCOPE, mode: "always_allow" },
  ];
  assert(
    effectiveDecision(sendAllow, "send_email", "to:a@b.com") === "ask",
    "always_allow on an irreversible send is downgraded to ask (guardrail)"
  );
  const sendNever: ToolPolicy[] = [
    { tool_name: "send_email", scope: WILDCARD_SCOPE, mode: "never" },
  ];
  assert(
    effectiveDecision(sendNever, "send_email", "to:a@b.com") === "never",
    "never on a send passes through"
  );
  const draftAllow: ToolPolicy[] = [
    { tool_name: "draft_email", scope: WILDCARD_SCOPE, mode: "always_allow" },
  ];
  assert(
    effectiveDecision(draftAllow, "draft_email", "to:a@b.com") === "always_allow",
    "always_allow on an eligible reversible tool is honoured"
  );
  assert(
    effectiveDecision([], "react_with_emoji", "channel:C9") === "ask",
    "empty policy → ask"
  );
}

function testLabels() {
  console.log("scope labels");
  assert(
    rememberScopeLabel("react_with_emoji", { channel: "C9" }) === " in this channel",
    "channel scope → 'in this channel'"
  );
  assert(
    rememberScopeLabel("draft_email", { to: "a@b.com" }) === " to this address",
    "recipient scope → 'to this address'"
  );
  assert(
    rememberScopeLabel("create_linear_issue", { title: "x" }) === "",
    "unscoped → empty suffix"
  );
  assert(describeScope(WILDCARD_SCOPE) === "any", "wildcard → 'any'");
  assert(
    describeScope("channel:C9") === "channel C9",
    "channel scope describes the channel"
  );
  assert(describeScope("to:a@b.com") === "a@b.com", "recipient scope strips prefix");
}

console.log("\npolicy.ts\n");
testEligibility();
testScope();
testResolve();
testEffective();
testLabels();

console.log(`\n${stats.pass} passed, ${stats.fail} failed\n`);
if (stats.fail > 0) process.exit(1);
