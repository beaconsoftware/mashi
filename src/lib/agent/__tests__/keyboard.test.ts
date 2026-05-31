/**
 * L2 (P6.c.b) — unit tests for the keyboard model: slash commands +
 * thread hotkeys.
 *
 * Self-running assertion script (no framework, matching tool-meta.test.ts /
 * provenance.test.ts). Runs with:
 *   pnpm test:keyboard
 */
import {
  SLASH_COMMANDS,
  findActiveSlash,
  matchSlashCommands,
} from "@/lib/agent/slash-commands";
import {
  resolveThreadHotkey,
  type HotkeyEvent,
  type ThreadHotkeyState,
} from "@/lib/agent/thread-hotkeys";

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

// --- slash command registry -------------------------------------------------
assert(SLASH_COMMANDS.length >= 6, `registry has ${SLASH_COMMANDS.length} commands`);

{
  // Names are unique.
  const names = SLASH_COMMANDS.map((c) => c.name);
  assert(new Set(names).size === names.length, "command names are unique");

  // Aliases never collide with another command's name.
  const nameSet = new Set(names);
  let aliasClash = false;
  for (const c of SLASH_COMMANDS)
    for (const a of c.aliases ?? [])
      if (nameSet.has(a) && a !== c.name) aliasClash = true;
  assert(!aliasClash, "aliases don't collide with command names");

  // Every command has a non-empty label/hint/expansion and a lowercase,
  // space-free name.
  let shapeOk = true;
  for (const c of SLASH_COMMANDS) {
    if (!c.label.trim() || !c.hint.trim() || !c.expansion.trim()) shapeOk = false;
    if (c.name !== c.name.toLowerCase() || /\s/.test(c.name)) shapeOk = false;
  }
  assert(shapeOk, "every command is well-shaped (label/hint/expansion, clean name)");

  // The completeness invariant: incomplete commands expand to a stem ending
  // in a space (caret lands after it); complete commands are whole prompts
  // that do not trail a space.
  let invariantOk = true;
  for (const c of SLASH_COMMANDS) {
    const endsSpace = /\s$/.test(c.expansion);
    if (c.complete && endsSpace) invariantOk = false;
    if (!c.complete && !endsSpace) invariantOk = false;
  }
  assert(invariantOk, "complete→whole prompt, incomplete→stem ending in a space");
}

// --- findActiveSlash --------------------------------------------------------
assert(
  JSON.stringify(findActiveSlash("/dr", 3)) ===
    JSON.stringify({ query: "dr", start: 0 }),
  "detects a leading slash command being typed"
);
assert(
  findActiveSlash("/", 1)?.query === "",
  "a bare slash opens the menu with an empty query"
);
assert(
  JSON.stringify(findActiveSlash("  /find", 7)) ===
    JSON.stringify({ query: "find", start: 2 }),
  "leading whitespace before the slash is allowed"
);
assert(
  findActiveSlash("hello /world", 12) === null,
  "a slash mid-prose does not trigger (URLs, and/or, dates stay safe)"
);
assert(
  findActiveSlash("/find my stuff", 14) === null,
  "once a space is typed the command token is committed (menu closes)"
);
assert(
  findActiveSlash("/draft", 3) !== null && findActiveSlash("/draft", 3)?.query === "dr",
  "the query is sliced to the caret, not the whole token"
);

// --- matchSlashCommands -----------------------------------------------------
assert(
  matchSlashCommands("").length === Math.min(6, SLASH_COMMANDS.length),
  "an empty query returns the (capped) full set"
);
assert(
  matchSlashCommands("draft")[0]?.name === "draft",
  "an exact name ranks first"
);
assert(
  matchSlashCommands("dr")[0]?.name === "draft",
  "a name prefix ranks its command first"
);
assert(
  matchSlashCommands("email").some((c) => c.name === "draft"),
  "an alias ('email') matches its command ('draft')"
);
assert(
  matchSlashCommands("zzzznope").length === 0,
  "a no-match query returns nothing"
);
assert(
  matchSlashCommands("a").length <= 6,
  "results are always capped at 6"
);

// --- resolveThreadHotkey ----------------------------------------------------
const ev = (over: Partial<HotkeyEvent>): HotkeyEvent => ({
  key: "",
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...over,
});
const st = (over: Partial<ThreadHotkeyState>): ThreadHotkeyState => ({
  hasApproval: false,
  hasRecallableUndo: false,
  composerEmpty: true,
  onActionControl: false,
  ...over,
});

assert(
  resolveThreadHotkey(ev({ key: "Enter", metaKey: true }), st({ hasApproval: true })) ===
    "approve",
  "⌘+Enter approves when an approval pends"
);
assert(
  resolveThreadHotkey(ev({ key: "Enter", ctrlKey: true }), st({ hasApproval: true })) ===
    "approve",
  "Ctrl+Enter approves too"
);
assert(
  resolveThreadHotkey(ev({ key: "Enter", metaKey: true }), st({ hasApproval: false })) ===
    null,
  "⌘+Enter is a no-op when nothing pends (composer still owns plain Enter)"
);
assert(
  resolveThreadHotkey(ev({ key: "Enter" }), st({ hasApproval: true })) === null,
  "plain Enter is never an approve (it's the composer's send)"
);
assert(
  resolveThreadHotkey(
    ev({ key: "z", metaKey: true }),
    st({ hasRecallableUndo: true, composerEmpty: true })
  ) === "undo",
  "⌘+Z undoes the latest recallable action when the composer is empty"
);
assert(
  resolveThreadHotkey(
    ev({ key: "z", metaKey: true }),
    st({ hasRecallableUndo: true, composerEmpty: false })
  ) === null,
  "⌘+Z is left to native undo while a draft is in the composer"
);
assert(
  resolveThreadHotkey(
    ev({ key: "z", metaKey: true, shiftKey: true }),
    st({ hasRecallableUndo: true })
  ) === null,
  "Shift+⌘+Z (redo) is not hijacked"
);
assert(
  resolveThreadHotkey(ev({ key: "ArrowDown" }), st({ onActionControl: true })) ===
    "focus-next",
  "ArrowDown roves to the next action control when one is focused"
);
assert(
  resolveThreadHotkey(ev({ key: "ArrowUp" }), st({ onActionControl: true })) ===
    "focus-prev",
  "ArrowUp roves to the previous action control"
);
assert(
  resolveThreadHotkey(ev({ key: "ArrowDown" }), st({ onActionControl: false })) ===
    null,
  "arrows don't rove when focus is in the composer (caret movement preserved)"
);
assert(
  resolveThreadHotkey(
    ev({ key: "ArrowDown", metaKey: true }),
    st({ onActionControl: true })
  ) === null,
  "a modified arrow is not roving"
);

console.log(`\nkeyboard: ${stats.pass} passed, ${stats.fail} failed`);
if (stats.fail > 0) process.exit(1);
