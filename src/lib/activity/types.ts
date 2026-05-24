/**
 * Shared types for the Activity Watcher subsystem.
 *
 * Mirrors the migration in supabase/migrations/022_activity_watcher.sql.
 * Keep these in lockstep with the DB CHECK constraints.
 */

export type ActivitySource = "mac_helper" | "browser_ext" | "cloud";

export type ActivitySurface =
  | "linear"
  | "gmail"
  | "slack"
  | "fireflies"
  | "github"
  | "cursor"
  | "claude_desktop"
  | "finder"
  | "terminal"
  | "web"
  | "other";

export type ActivitySignalKind =
  | "open"
  | "focus"
  | "close"
  | "merge"
  | "archive"
  | "idle_end";

export type ProposedState = "in_progress" | "done";

export type SuggestionStatus =
  | "pending"
  | "confirmed"
  | "rejected"
  | "dismissed"
  | "expired";

export type MatcherSignalKind =
  | "exact_id"
  | "url_match"
  | "title_embed"
  | "cloud_lifecycle";

/**
 * One inbound event from a feeder. Validated at the route boundary.
 */
export interface HeartbeatEvent {
  surface: ActivitySurface | string; // string for forward-compat
  identifier?: string;
  title?: string;
  app?: string;
  url?: string;
  signal_kind: ActivitySignalKind;
  started_at: string; // ISO-8601
  ended_at?: string;
}

export interface HeartbeatRequest {
  source: ActivitySource;
  client_id: string;
  events: HeartbeatEvent[];
}

export interface HeartbeatResponse {
  ingested: number;
  new_suggestions: number;
}

/**
 * Context attached to every suggestion. The UI renders `reason_human`
 * verbatim, then lists `signal_snippets` as bullet points.
 */
export interface SuggestionContext {
  reason_human: string;
  event_ids: string[];
  signal_snippets: Array<{
    source: ActivitySource;
    surface: string;
    title?: string;
    url?: string;
    app?: string;
    when: string;
  }>;
}
