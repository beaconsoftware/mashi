/**
 * I9 — tool-call card identity: the pure tool → {icon, label} mapping plus a
 * collapsed-state outcome extractor.
 *
 * Pure and dependency-free (no React / lucide / DB), so it's unit-tested in
 * isolation (`pnpm test:tool-meta`) and importable on either side of the
 * wire. The React layer (`tool.tsx`) maps the `icon` key to a concrete lucide
 * glyph; keeping the key a plain string here means this module stays testable
 * and the registry-coverage test has no heavy import chain to drag in.
 *
 *   - `toolMeta(name)` → a human label + an icon key for any tool. Every
 *     registry tool has an explicit entry; an unknown name degrades to a
 *     humanized label + the generic icon (never throws). The coverage test
 *     asserts the registry and this map stay in sync.
 *   - `toolOutcome(name, output, isError)` → a one-line "what happened"
 *     ("12 board items", "MASH-1130 · Title", "Done") for the collapsed card,
 *     so the card conveys the result without expanding. Reuses the C2/C1
 *     provenance derivations so the shape-knowledge lives in one place.
 */

import { deriveSources, summarizeToolResult } from "@/lib/agent/provenance";

/** The set of semantic icon families a tool card can show. `tool.tsx` maps
 * each to a lucide glyph; `generic` is the unmapped fallback (a wrench). */
export type ToolIconKey =
  | "search"
  | "board"
  | "item"
  | "person"
  | "whoami"
  | "company"
  | "style"
  | "message"
  | "meeting"
  | "calendar"
  | "today"
  | "linear"
  | "sync"
  | "context"
  | "sprint"
  | "review"
  | "summary"
  | "chain"
  | "reference"
  | "question"
  | "decision"
  | "watch"
  | "plan"
  | "mail"
  | "emoji"
  | "memory"
  | "generic";

export interface ToolMeta {
  icon: ToolIconKey;
  /** Human-readable, sentence-case action label, e.g. "Search the board". */
  label: string;
}

/** Explicit meta for every tool in `TOOL_REGISTRY`. Kept in registry order so
 * the two are easy to diff; the coverage test fails if a registry tool is
 * missing here. */
export const TOOL_META: Record<string, ToolMeta> = {
  // Ring 1 — read
  get_item: { icon: "item", label: "Open an item" },
  search_board: { icon: "board", label: "Search the board" },
  whoami: { icon: "whoami", label: "Look up your profile" },
  list_today: { icon: "today", label: "Review today" },
  list_companies: { icon: "company", label: "List companies" },
  who_is: { icon: "person", label: "Look up a person" },
  get_style: { icon: "style", label: "Check your writing style" },
  context_for_item: { icon: "item", label: "Gather item context" },
  get_message_thread: { icon: "message", label: "Open a message thread" },
  search_messages: { icon: "message", label: "Search messages" },
  get_meeting: { icon: "meeting", label: "Open a meeting" },
  search_meetings: { icon: "meeting", label: "Search meetings" },
  get_calendar_event: { icon: "calendar", label: "Open a calendar event" },
  get_linear_issue: { icon: "linear", label: "Open a Linear issue" },
  search_linear: { icon: "linear", label: "Search Linear" },
  search_everything: { icon: "search", label: "Search everything" },
  run_sync: { icon: "sync", label: "Sync your accounts" },
  get_cursor_context: { icon: "context", label: "Check what you're viewing" },
  get_today: { icon: "today", label: "Review today" },
  get_current_sprint: { icon: "sprint", label: "Check the current sprint" },
  list_needs_review: { icon: "review", label: "List items needing review" },
  get_thread_summary: { icon: "summary", label: "Summarize the thread" },
  get_spawn_chain: { icon: "chain", label: "Trace the follow-up chain" },
  resolve_reference: { icon: "reference", label: "Resolve a reference" },
  list_recent_threads: { icon: "message", label: "List recent threads" },
  ask_followup_question: { icon: "question", label: "Ask a follow-up" },
  // Ring 2 — write_mashi
  create_item: { icon: "item", label: "Create an item" },
  update_item: { icon: "item", label: "Update an item" },
  complete_item: { icon: "item", label: "Complete an item" },
  snooze_item: { icon: "item", label: "Snooze an item" },
  set_item_pathway: { icon: "item", label: "Set the item pathway" },
  set_item_planned_for: { icon: "item", label: "Schedule an item" },
  set_item_title: { icon: "item", label: "Rename an item" },
  set_item_description: { icon: "item", label: "Edit the item description" },
  set_item_priority: { icon: "item", label: "Set the item priority" },
  set_item_company: { icon: "item", label: "Set the item company" },
  set_item_snoozed_until: { icon: "item", label: "Snooze an item" },
  merge_items: { icon: "item", label: "Merge items" },
  spawn_follow_up: { icon: "chain", label: "Spawn a follow-up" },
  approve_review_item: { icon: "review", label: "Approve a review item" },
  reject_review_item: { icon: "review", label: "Reject a review item" },
  complete_block: { icon: "sprint", label: "Complete a block" },
  set_success_statement: { icon: "sprint", label: "Set the success statement" },
  log_decision: { icon: "decision", label: "Log a decision" },
  record_watch_check_in: { icon: "watch", label: "Record a watch check-in" },
  set_watch_target: { icon: "watch", label: "Set a watch target" },
  set_plan: { icon: "plan", label: "Update the plan" },
  attach_thread_to_item: { icon: "reference", label: "Attach thread to an item" },
  propose_memory: { icon: "memory", label: "Remember this" },
  list_linear_teams: { icon: "linear", label: "List Linear teams" },
  // Ring 3 — write_world
  send_email: { icon: "mail", label: "Send an email" },
  draft_email: { icon: "mail", label: "Draft an email" },
  mark_email_read: { icon: "mail", label: "Mark an email read" },
  archive_email: { icon: "mail", label: "Archive an email" },
  send_slack_message: { icon: "message", label: "Send a Slack message" },
  react_with_emoji: { icon: "emoji", label: "React with an emoji" },
  create_calendar_event: { icon: "calendar", label: "Create a calendar event" },
  update_calendar_event: { icon: "calendar", label: "Update a calendar event" },
  staged_to_meeting: { icon: "meeting", label: "Add to a meeting" },
  create_linear_issue: { icon: "linear", label: "Create a Linear issue" },
  update_linear_issue: { icon: "linear", label: "Update a Linear issue" },
  comment_on_linear_issue: { icon: "linear", label: "Comment on a Linear issue" },
};

/** "search_board" → "Search board" — the graceful fallback label for a tool
 * with no explicit entry (a newly-added tool whose meta hasn't landed yet). */
function humanize(toolName: string): string {
  const words = toolName.replace(/[_-]+/g, " ").trim();
  if (!words) return "Run a tool";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Meta for a tool name. Explicit entry when we have one, else a humanized
 * label + the generic icon. Never throws — an unmapped tool degrades. */
export function toolMeta(toolName: string): ToolMeta {
  return TOOL_META[toolName] ?? { icon: "generic", label: humanize(toolName) };
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/**
 * A compact "what happened" line for the collapsed card. Returns null when
 * nothing useful can be said (the badge already conveys running / error /
 * cancelled), so the caller renders just the label.
 *
 * Order: a typed C2 summary headline (lists/searches) → a single C1 source
 * title (single-resource fetches like get_item) → a best-effort note for
 * write tools (ticket number, or "Done") → null.
 */
export function toolOutcome(
  toolName: string,
  output: unknown,
  isError: boolean
): string | null {
  if (isError) return null;

  const summary = summarizeToolResult(toolName, output);
  if (summary) return summary.headline;

  const sources = deriveSources(toolName, output);
  if (sources.length === 1) return sources[0].title;
  if (sources.length > 1) return `${sources.length} sources`;

  const rec = asRecord(output);
  if (rec) {
    const ticket = rec.ticket_number;
    if (typeof ticket === "string" && ticket.length > 0) return ticket;
    const title = rec.title;
    if (typeof title === "string" && title.length > 0) return title;
    if (rec.ok === true || rec.success === true) return "Done";
  }
  return null;
}
