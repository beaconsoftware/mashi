// Shared types for Mashi. Mirrors the Supabase schema (spec §6).
// When the real Supabase types are generated (`supabase gen types typescript`),
// reconcile or replace these.

export type S2DStatus = "backlog" | "todo" | "in_progress" | "in_queue" | "done";

export type Pathway =
  | "quick_reply"
  | "drafted_response"
  | "meeting_backed"
  | "heads_down"
  | "decision_gate"
  | "delegated"
  | "watching";

export type Priority = "urgent" | "high" | "medium" | "low";

export type Energy = "low" | "medium" | "high";

export type SourceType =
  | "linear"
  | "gmail"
  | "slack"
  | "fireflies"
  | "granola"
  | "calendar"
  | "manual";

export type SprintType = "morning" | "midday" | "eod" | "power_hour";

export interface Company {
  id: string;
  name: string;
  color_hex: string;
  status?: "active" | "exited" | "prospect";
  email_domain?: string | null;
}

export interface S2DItem {
  id: string;
  /**
   * Stable, human-readable integer ID. Display as `MASH-${ticket_number}`.
   * Auto-assigned by Postgres sequence on insert. Optional only because
   * legacy mock fixtures predate the column; every real DB row has one.
   */
  ticket_number?: number;
  /**
   * Triage review queue flag. AI-triaged items land here for the user
   * to approve before they join the actual board. Manual creates skip
   * (user already chose the column when adding).
   */
  needs_review?: boolean;
  /**
   * 1-2 sentence explanation of why this priority + pathway, shown on
   * the swipe-deck review card. Populated by triage at create time.
   */
  review_justification?: string | null;
  title: string;
  description?: string | null;
  status: S2DStatus;
  pathway: Pathway;
  priority: Priority;
  est_minutes?: number | null;
  energy?: Energy;
  source_type?: SourceType;
  source_id?: string | null;
  /**
   * Upstream provider's stable identifier for the thread/issue/event
   * this item came from. (`source_id` is a Mashi-side composite of
   * thread_id + a title slug; `source_thread_id` is the raw upstream
   * id used to deep-link back to the source app.)
   */
  source_thread_id?: string | null;
  source_url?: string | null;
  source_label?: string | null;
  company_id?: string | null;
  company?: Company | null;
  ai_suggestion?: string | null;
  ai_suggestion_generated_at?: string | null;
  ai_draft?: string | null;
  sprint_date?: string | null;
  sprint_order?: number | null;
  sprint_type?: SprintType | null;
  queue_reason?: string | null;
  queue_until?: string | null;
  delegated_to?: string | null;
  outcome?: string | null;
  resolved_via?: string | null;
  snoozed_until?: string | null;
  linked_sources?: Array<{
    source_type?: string | null;
    source_thread_id?: string | null;
    source_label?: string | null;
    merged_from_s2d_id?: string;
    merged_at?: string;
  }>;
  /**
   * When sprint planner books a time block for this item.
   * sprint_calendar_event_id is the GCal event id (only set if user opted
   * to push the block to their calendar).
   */
  sprint_start_at?: string | null;
  sprint_end_at?: string | null;
  sprint_calendar_event_id?: string | null;
  sprint_calendar_account_id?: string | null;
  /**
   * Flips to true whenever the triage/reconcile/bundle passes mutate an
   * existing row's content. Cleared (a) by opening the detail sheet
   * (2s delay so the pulsing dot is actually visible) or (b) by the
   * "Mark read" button in the sheet callout.
   */
  has_unseen_updates?: boolean;
  /** 1-sentence "what changed" from the agent's TriageUpdateOp.reason. */
  last_update_summary?: string | null;
  last_update_at?: string | null;
  created_at: string;
  updated_at: string;
  done_at?: string | null;
}

export interface PathwayMeta {
  key: Pathway;
  label: string;
  shortLabel: string;
  icon: string; // single-char glyph for compact display
  colorVar: string; // CSS var name
  description: string;
}

export const PATHWAY_META: Record<Pathway, PathwayMeta> = {
  quick_reply: {
    key: "quick_reply",
    label: "Quick reply",
    shortLabel: "Quick",
    icon: "⚡",
    colorVar: "--pw-quick",
    description: "A short message that can be drafted and sent in under 5 minutes.",
  },
  drafted_response: {
    key: "drafted_response",
    label: "Drafted response",
    shortLabel: "Draft",
    icon: "✎",
    colorVar: "--pw-draft",
    description: "A fuller response that needs drafting and iteration before sending.",
  },
  meeting_backed: {
    key: "meeting_backed",
    label: "Meeting-backed",
    shortLabel: "Meeting",
    icon: "◷",
    colorVar: "--pw-meeting",
    description: "Will be addressed in a specific upcoming meeting.",
  },
  heads_down: {
    key: "heads_down",
    label: "Heads-down work",
    shortLabel: "Focus",
    icon: "◉",
    colorVar: "--pw-focus",
    description: "Requires a focused calendar block of work.",
  },
  decision_gate: {
    key: "decision_gate",
    label: "Decision gate",
    shortLabel: "Decide",
    icon: "◆",
    colorVar: "--pw-decision",
    description: "A discrete decision is required to unblock progress.",
  },
  delegated: {
    key: "delegated",
    label: "Delegated",
    shortLabel: "Delegate",
    icon: "→",
    colorVar: "--pw-delegate",
    description: "Handed off to someone else; tracking outcome.",
  },
  watching: {
    key: "watching",
    label: "Watching",
    shortLabel: "Watch",
    icon: "○",
    colorVar: "--pw-watching",
    description: "Action taken — waiting for a response or external event.",
  },
};

export const STATUS_META: Record<S2DStatus, { label: string; description: string }> = {
  backlog: { label: "Backlog", description: "Captured, not yet triaged" },
  todo: { label: "To Do", description: "Triaged, ready to schedule" },
  in_progress: { label: "In Progress", description: "Active work" },
  in_queue: { label: "In Queue", description: "Blocked externally — waiting" },
  done: { label: "Done", description: "Resolved" },
};

export const STATUS_ORDER: S2DStatus[] = ["backlog", "todo", "in_progress", "in_queue", "done"];

export const PRIORITY_META: Record<Priority, { label: string; color: string }> = {
  urgent: { label: "Urgent", color: "hsl(0 75% 60%)" },
  high: { label: "High", color: "hsl(21 80% 60%)" },
  medium: { label: "Medium", color: "hsl(43 96% 56%)" },
  low: { label: "Low", color: "hsl(240 5% 45%)" },
};
