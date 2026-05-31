/**
 * L2 (P6.c.b) — slash commands, shared pure module.
 *
 * Sibling of `references.ts`: no DB / SDK / browser-client / React imports, so
 * the composer typeahead and the unit tests (`__tests__/keyboard.test.ts`)
 * share one source of truth. The composer renders the icon by mapping the
 * string `icon` key to a lucide component (the same indirection `tool-meta`
 * uses), so this file stays dependency-free.
 *
 * A slash command is a *fast intent path*, not a direct tool call. Selecting
 * one only ever puts natural-language text into the turn (either sent straight
 * away, or as a stem the user finishes typing); it then flows through the exact
 * same `send` pipeline a typed message takes, so every ring + approval gate
 * still applies. Slash commands never bypass the loop.
 *
 *   - `complete: true`  → the expansion is a whole prompt; selecting sends it.
 *   - `complete: false` → the expansion is a stem ending in a space; selecting
 *     drops it into the composer and leaves the caret at the end so the user
 *     types the specifics, then hits Enter.
 */

/** Icon keys resolved to lucide components by the composer (kept out of this
 * pure module so it imports nothing). */
export type SlashIconKey =
  | "search"
  | "draft"
  | "brief"
  | "schedule"
  | "plan"
  | "snooze"
  | "remember"
  | "summarize"
  | "today";

export interface SlashCommand {
  /** The token typed after `/`, lowercase, no spaces. Unique. */
  name: string;
  /** Extra tokens that also match this command in the typeahead. */
  aliases?: string[];
  /** One-line menu label. */
  label: string;
  /** Short hint shown muted beside the label. */
  hint: string;
  icon: SlashIconKey;
  /** The natural-language text the command expands to. For `complete`
   * commands this is a full prompt; otherwise a stem ending in a space. */
  expansion: string;
  /** When true, selecting the command sends `expansion` as a turn straight
   * away. When false, `expansion` is inserted and the caret is left at its
   * end for the user to finish. */
  complete: boolean;
}

/**
 * The built-in command set. Ordered by rough frequency of use — that order is
 * also the tie-break when several commands match a query equally well, and the
 * order an empty `/` query shows.
 */
export const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: "find",
    aliases: ["search"],
    label: "Find",
    hint: "search the board",
    icon: "search",
    expansion: "Find ",
    complete: false,
  },
  {
    name: "draft",
    aliases: ["reply", "email"],
    label: "Draft",
    hint: "write a reply or email",
    icon: "draft",
    expansion: "Draft ",
    complete: false,
  },
  {
    name: "schedule",
    aliases: ["cal", "calendar"],
    label: "Schedule",
    hint: "put something on the calendar",
    icon: "schedule",
    expansion: "Schedule ",
    complete: false,
  },
  {
    name: "snooze",
    label: "Snooze",
    hint: "defer this item",
    icon: "snooze",
    expansion: "Snooze ",
    complete: false,
  },
  {
    name: "plan",
    label: "Plan",
    hint: "lay out the next steps",
    icon: "plan",
    expansion: "Lay out a plan for ",
    complete: false,
  },
  {
    name: "remember",
    aliases: ["note"],
    label: "Remember",
    hint: "save a durable preference",
    icon: "remember",
    expansion: "Remember that ",
    complete: false,
  },
  {
    name: "today",
    aliases: ["plate"],
    label: "Today",
    hint: "what's on my plate",
    icon: "today",
    expansion: "What is on my plate today?",
    complete: true,
  },
  {
    name: "brief",
    aliases: ["catchup", "digest"],
    label: "Brief",
    hint: "catch me up",
    icon: "brief",
    expansion: "Give me a brief on what changed and what needs my attention.",
    complete: true,
  },
  {
    name: "summarize",
    aliases: ["summary", "tldr"],
    label: "Summarize",
    hint: "recap this thread",
    icon: "summarize",
    expansion: "Summarize this thread so far.",
    complete: true,
  },
];

/**
 * Detect an in-progress `/` command at the caret. A slash command is only
 * active at the very start of the composer (after optional leading
 * whitespace), so prose containing slashes (URLs, dates, "and/or") never
 * triggers the menu. Returns the query (text after `/`) and the `/`'s index,
 * or null when the caret isn't inside a leading slash token.
 */
export function findActiveSlash(
  value: string,
  caret: number
): { query: string; start: number } | null {
  // The slash must be the first non-whitespace character of the input.
  const lead = value.slice(0, caret);
  const match = /^(\s*)\/(\S*)$/.exec(lead);
  if (!match) return null;
  const start = match[1].length;
  const query = match[2];
  if (query.length > 32) return null;
  return { query, start };
}

/**
 * Rank the command set against a typeahead query. An empty query returns the
 * full set in registry order. Otherwise: exact name/alias first, then name
 * prefix, then alias prefix, then a substring of name/label/hint. Ties keep
 * registry order (stable sort). Capped at 6, matching the @-mention menu.
 */
export function matchSlashCommands(query: string): SlashCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return SLASH_COMMANDS.slice(0, 6);
  const scored: Array<{ cmd: SlashCommand; score: number }> = [];
  for (const cmd of SLASH_COMMANDS) {
    const names = [cmd.name, ...(cmd.aliases ?? [])];
    let score = -1;
    if (names.some((n) => n === q)) score = 4;
    else if (cmd.name.startsWith(q)) score = 3;
    else if (names.some((n) => n.startsWith(q))) score = 2;
    else if (
      cmd.name.includes(q) ||
      cmd.label.toLowerCase().includes(q) ||
      cmd.hint.toLowerCase().includes(q) ||
      names.some((n) => n.includes(q))
    )
      score = 1;
    if (score >= 0) scored.push({ cmd, score });
  }
  // Stable sort by score desc; Array.prototype.sort is stable in modern V8 so
  // equal-score commands keep their registry order.
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 6).map((s) => s.cmd);
}
