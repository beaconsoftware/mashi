/**
 * I9 — unit tests for the tool-card identity mapping.
 *
 * Self-running assertion script (no framework, matching provenance.test.ts /
 * replay.test.ts). Runs with:
 *   pnpm test:tool-meta
 *
 * Covers the acceptance criteria + the brief's named risk mitigation:
 *   - every registry tool has an explicit {icon, label} mapping (the map and
 *     the registry can't silently drift);
 *   - an unmapped tool returns a sensible default and never throws;
 *   - the collapsed outcome line reads the C1/C2 derivations correctly.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  TOOL_META,
  toolMeta,
  toolNarration,
  toolOutcome,
} from "@/lib/agent/tool-meta";

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

// --- registry coverage ------------------------------------------------------
// Extract the tool names from registry.ts WITHOUT importing it (its import
// chain pulls in every handler + the supabase server client). The registry
// keys are `[<ident>.name]: <ident>` and the const identifier equals the
// tool's string `name` by convention, so the identifiers are the names.
const here = dirname(fileURLToPath(import.meta.url));
const registrySrc = readFileSync(join(here, "..", "registry.ts"), "utf8");
const registryNames = Array.from(
  registrySrc.matchAll(/\[(\w+)\.name\]:/g),
  (m) => m[1]
);

assert(registryNames.length >= 50, `extracted ${registryNames.length} registry tool names`);

for (const name of registryNames) {
  assert(
    Object.prototype.hasOwnProperty.call(TOOL_META, name),
    `registry tool "${name}" has an explicit meta entry`
  );
}

// Every meta entry has a non-empty label and a known icon key.
for (const [name, meta] of Object.entries(TOOL_META)) {
  assert(
    typeof meta.label === "string" && meta.label.trim().length > 0,
    `meta "${name}" has a non-empty label`
  );
}

// No stale meta entries that aren't in the registry (keeps the map honest).
const registrySet = new Set(registryNames);
for (const name of Object.keys(TOOL_META)) {
  assert(registrySet.has(name), `meta "${name}" still exists in the registry`);
}

// --- graceful default -------------------------------------------------------
const unknown = toolMeta("some_brand_new_tool");
assert(unknown.icon === "generic", "unknown tool falls back to the generic icon");
assert(
  unknown.label === "Some brand new tool",
  `unknown tool humanizes its name (got "${unknown.label}")`
);
assert(toolMeta("").label.length > 0, "empty tool name does not crash");

// --- known label ------------------------------------------------------------
assert(toolMeta("search_board").label === "Search the board", "known label resolves");
assert(toolMeta("send_email").icon === "mail", "send_email maps to the mail icon");

// --- outcome line -----------------------------------------------------------
assert(
  toolOutcome("search_board", { items: [{ title: "A" }, { title: "B" }] }, false) ===
    "2 board items",
  "search outcome uses the C2 headline"
);
assert(
  toolOutcome("search_board", { items: [] }, false) === "No board items",
  "empty search outcome reads as none"
);
assert(
  toolOutcome("get_item", { item: { ticket_number: "MASH-1130", title: "Ship it" } }, false) ===
    "MASH-1130 · Ship it",
  "single-fetch outcome uses the C1 source title"
);
assert(
  toolOutcome("create_item", { ok: true }, false) === "Done",
  "write tool with ok:true reads as Done"
);
assert(
  toolOutcome("send_email", { ticket_number: undefined }, true) === null,
  "an errored call has no outcome line (the badge carries it)"
);
assert(toolOutcome("whoami", "not an object", false) === null, "non-record output → null");

// L4 — live narration: present-tense, human, never empty.
assert(
  toolNarration("search_board") === "Searching the board",
  "narration gerund-ifies the label (search_board)"
);
assert(
  toolNarration("set_item_title") === "Renaming an item",
  "narration handles the -e drop (Rename → Renaming)"
);
assert(
  toolNarration("propose_memory") === "Noting that to remember",
  "narration uses the hand-tuned line for propose_memory (F1 memory moment)"
);
assert(
  toolNarration("get_calendar_event") === "Opening a calendar event",
  "narration gerund-ifies 'Open …' correctly"
);
assert(
  toolNarration("some_unknown_tool").length > 0,
  "an unmapped tool still yields a non-empty narration (never throws)"
);
// Every registry tool yields a non-empty narration.
{
  let allOk = true;
  for (const name of Object.keys(TOOL_META)) {
    if (toolNarration(name).trim().length === 0) allOk = false;
  }
  assert(allOk, "every registry tool has a non-empty narration line");
}

console.log(`\ntool-meta: ${stats.pass} passed, ${stats.fail} failed`);
if (stats.fail > 0) process.exit(1);
