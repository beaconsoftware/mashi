/**
 * Shared types between background, popup, and options scripts.
 *
 * Heartbeat shape mirrors src/lib/activity/types.ts in the Mashi repo —
 * keep in lockstep with the route validator at
 * src/app/api/activity/heartbeat/route.ts.
 */

export type ActivitySignalKind =
  | "open"
  | "focus"
  | "close"
  | "merge"
  | "archive"
  | "idle_end";

export interface HeartbeatEvent {
  surface: string;
  identifier?: string;
  title?: string;
  app?: string;
  url?: string;
  signal_kind: ActivitySignalKind;
  started_at: string;
  ended_at?: string;
}

export interface HeartbeatRequest {
  source: "browser_ext";
  client_id: string;
  events: HeartbeatEvent[];
}

export interface HeartbeatResponse {
  ingested: number;
  new_suggestions: number;
}

/**
 * Persisted in chrome.storage.local. Renamed/extended cautiously —
 * extension upgrades preserve storage across versions.
 */
export interface ExtSettings {
  mashiUrl: string;
  token: string;
  clientId: string;
  customIgnoreDomains: string[];
  /** Set by background when a heartbeat returns 401. UI surfaces "Token invalid". */
  tokenInvalid: boolean;
  /** ISO timestamp; if in future, we don't dispatch. */
  pausedUntil: string | null;
  /** Last status surface for the popup. */
  lastStatus:
    | "live"
    | "paused"
    | "no_token"
    | "token_invalid"
    | "watcher_disabled";
  lastHeartbeatAt: string | null;
  lastError: string | null;
}

export const DEFAULT_SETTINGS: ExtSettings = {
  mashiUrl: "https://mashi-two.vercel.app",
  token: "",
  clientId: "",
  customIgnoreDomains: [],
  tokenInvalid: false,
  pausedUntil: null,
  lastStatus: "no_token",
  lastHeartbeatAt: null,
  lastError: null,
};

/**
 * Hardcoded default ignore list — sensitive surfaces we never want to
 * heartbeat about. Matches by exact hostname OR suffix (e.g. ".bank"
 * matches "chase.bank" and "wells.bank"). Mirrors backend
 * ignore_domains semantics.
 */
export const DEFAULT_IGNORE_DOMAINS: string[] = [
  "chase.com",
  "bankofamerica.com",
  "wellsfargo.com",
  "capitalone.com",
  "citi.com",
  "usbank.com",
  "1password.com",
  ".bank",
  "mybank.",
  "therapy",
  ".therapy",
  "betterhelp.com",
  "talkspace.com",
];

/**
 * Messages exchanged between popup/options and background via
 * chrome.runtime.sendMessage. The reply shape matches the discriminant.
 */
export type ExtMessage =
  | { type: "get_status" }
  | { type: "test_connection" }
  | { type: "pause"; durationMinutes: number }
  | { type: "resume" }
  | { type: "settings_changed" };

export interface StatusReply {
  settings: ExtSettings;
}

export interface TestConnectionReply {
  ok: boolean;
  status?: number;
  ingested?: number;
  message?: string;
}
