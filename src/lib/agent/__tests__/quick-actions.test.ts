/**
 * L3 (P6.c.b) — unit tests for the contextual quick-action derivation.
 *
 * Self-running assertion script (no framework, matching tool-meta.test.ts /
 * provenance.test.ts). Runs with:
 *   pnpm test:quick-actions
 */
import {
  deriveQuickActions,
  type QuickAction,
} from "@/lib/agent/quick-actions";

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

const ids = (chips: QuickAction[]) => chips.map((c) => c.id);

// --- nothing confident → no chips ------------------------------------------
assert(
  deriveQuickActions({ toolNames: [], itemCount: 0 }).length === 0,
  "no signals → no chips (the row hides rather than guessing)"
);
assert(
  deriveQuickActions({ toolNames: ["get_current_sprint"], itemCount: 0 }).length === 0,
  "an unmapped tool yields no chips"
);

// --- a list read surfaces triage chips -------------------------------------
{
  const chips = deriveQuickActions({ toolNames: ["search_board"], itemCount: 5 });
  assert(
    ids(chips).includes("most-urgent") && ids(chips).includes("plan-day"),
    "a board read with items offers triage chips"
  );
}
assert(
  deriveQuickActions({ toolNames: ["search_board"], itemCount: 0 }).length === 0,
  "a board read with zero items offers no list chips"
);
assert(
  deriveQuickActions({ toolNames: ["list_today"], itemCount: 3 }).some(
    (c) => c.id === "most-urgent"
  ),
  "list_today also counts as a list read"
);

// --- a draft offers send/tweak ---------------------------------------------
{
  const chips = deriveQuickActions({ toolNames: ["draft_email"], itemCount: 0 });
  assert(
    ids(chips).includes("send-draft") && ids(chips).includes("tone-draft"),
    "a draft offers Send it + Adjust the tone"
  );
  assert(
    chips.find((c) => c.id === "send-draft")?.prompt === "Send that draft.",
    "the send chip carries a natural-language prompt (dispatched through send)"
  );
}

// --- single-item + reply + create + plan -----------------------------------
assert(
  deriveQuickActions({ toolNames: ["get_item"], itemCount: 0 }).some(
    (c) => c.id === "snooze-item"
  ),
  "a fetched item offers snooze/done"
);
assert(
  deriveQuickActions({ toolNames: ["get_message_thread"], itemCount: 0 }).some(
    (c) => c.id === "draft-reply"
  ),
  "a read thread offers Draft a reply"
);
assert(
  deriveQuickActions({ toolNames: ["create_item"], itemCount: 0 }).some(
    (c) => c.id === "add-sprint"
  ),
  "a create offers Add to sprint"
);
assert(
  deriveQuickActions({ toolNames: ["set_plan"], itemCount: 0 }).some(
    (c) => c.id === "start-plan"
  ),
  "a plan offers Start step one"
);

// --- dedup + cap ------------------------------------------------------------
{
  const chips = deriveQuickActions({
    toolNames: ["search_board", "search_board", "draft_email"],
    itemCount: 2,
  });
  assert(
    new Set(ids(chips)).size === ids(chips).length,
    "repeated tool calls don't duplicate chips"
  );
  assert(chips.length <= 4, "the chip set is capped at 4");
}
{
  // Many distinct signals still cap at 4, preserving derivation order.
  const chips = deriveQuickActions({
    toolNames: ["draft_email", "get_item", "create_item", "set_plan"],
    itemCount: 0,
  });
  assert(chips.length === 4, "a busy turn is capped to 4 chips");
}

console.log(`\nquick-actions: ${stats.pass} passed, ${stats.fail} failed`);
if (stats.fail > 0) process.exit(1);
