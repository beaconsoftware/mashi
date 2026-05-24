/**
 * Matcher v1 — turn heartbeat events into activity_suggestions.
 *
 * Only the cheap, high-confidence paths in v1:
 *   - exact_id:  the heartbeat carries an identifier (Linear MAP-123,
 *                Gmail thread id, Slack channel id, GitHub PR url) that
 *                matches an s2d_item's source_id OR appears in title /
 *                description.
 *   - url_match: heartbeat URL matches s2d_item.source_url byte-for-byte
 *                after canonicalization.
 *   - cloud_lifecycle: signal_kind in ('close','merge','archive') from a
 *                cloud source — high-confidence Done indicator.
 *
 * Title-embedding fuzzy match is matcher v2; not in scope for P1.
 *
 * Stage gate: `s2d_items.needs_review = false`. Items still in the review
 * queue are off-limits, per PRD §2 G4.
 *
 * Dedup: don't create a new suggestion for the same (item, proposed_state)
 * within 30 minutes of the most recent one (regardless of status — even a
 * just-rejected suggestion stays quiet).
 *
 * State-transition rules:
 *   - To propose `in_progress`: item.status IN ('backlog','todo','in_queue')
 *   - To propose `done`:        item.status = 'in_progress'
 *   - Anything else: no suggestion.
 *
 * Confidence floor: 0.85. Below that, no suggestion ever fires.
 */

import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type {
  ActivitySource,
  HeartbeatEvent,
  MatcherSignalKind,
  ProposedState,
  SuggestionContext,
} from "./types";

const MIN_CONFIDENCE = 0.85;
const DEDUP_WINDOW_MIN = 30;

// Cloud-lifecycle signals that imply "Done"
const DONE_SIGNAL_KINDS = new Set(["close", "merge", "archive"]);

interface MatchedSuggestion {
  s2d_item_id: string;
  proposed_state: ProposedState;
  confidence: number;
  signal_kind: MatcherSignalKind;
  context: SuggestionContext;
}

/**
 * Find candidate s2d_items the user owns that could correspond to the
 * heartbeat event. Returns at most one match — multi-match resolution is
 * intentionally absent in v1 (better quiet than wrong).
 */
async function findCandidateItem(opts: {
  userId: string;
  event: HeartbeatEvent;
}): Promise<{
  id: string;
  status: string;
  title: string;
  match_kind: "source_id" | "source_url" | "description_id";
} | null> {
  const { userId, event } = opts;
  const supabase = createSupabaseServiceClient();

  // 1. Try source_thread_id match if identifier present.
  //
  // Note: the column is `source_thread_id`, NOT `source_id`. The triage
  // pipeline writes the raw provider ID (Linear UUID, Gmail thread id,
  // Slack channel id) into `source_thread_id` and packs `source_id` as
  // `${source_thread_id}:${slug(title)}` — a composite that we'd never
  // be able to reconstruct from a heartbeat. See orchestrator.ts:327-328.
  if (event.identifier) {
    const { data } = await supabase
      .from("s2d_items")
      .select("id, status, title")
      .eq("user_id", userId)
      .eq("needs_review", false)
      .eq("source_thread_id", event.identifier)
      .limit(1)
      .maybeSingle();
    if (data) {
      return { ...data, match_kind: "source_id" };
    }
  }

  // 2. Try canonical URL match.
  if (event.url) {
    const canonicalUrl = canonicalize(event.url);
    if (canonicalUrl) {
      const { data } = await supabase
        .from("s2d_items")
        .select("id, status, title")
        .eq("user_id", userId)
        .eq("needs_review", false)
        .eq("source_url", canonicalUrl)
        .limit(1)
        .maybeSingle();
      if (data) {
        return { ...data, match_kind: "source_url" };
      }
    }
  }

  // 3. Try identifier-in-description (e.g. PR description mentions Linear ID).
  if (event.identifier) {
    const { data } = await supabase
      .from("s2d_items")
      .select("id, status, title")
      .eq("user_id", userId)
      .eq("needs_review", false)
      .ilike("description", `%${event.identifier}%`)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) {
      return { ...data, match_kind: "description_id" };
    }
  }

  return null;
}

/**
 * Drop tracking params, trailing slashes, fragments. Keeps schemes + paths
 * stable so equality compares meaningfully.
 */
export function canonicalize(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl);
    u.hash = "";
    const stripParams = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "ref",
      "ref_src",
      "ref_url",
      "gclid",
      "fbclid",
    ];
    for (const p of stripParams) u.searchParams.delete(p);
    // Trailing slash normalization
    let pathname = u.pathname;
    if (pathname.length > 1 && pathname.endsWith("/")) pathname = pathname.slice(0, -1);
    u.pathname = pathname;
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * What state transition is plausible given an item's current status and the
 * incoming signal?
 *   - `in_progress` proposal makes sense when the item is unstarted
 *     ('backlog' | 'todo' | 'in_queue') and the signal is a working signal.
 *   - `done` proposal makes sense when the item is currently 'in_progress'
 *     and the signal is a completion signal (close/merge/archive from
 *     cloud) — OR for Phase 1, also when the user has stopped touching it
 *     after recent activity (deferred to matcher v2).
 */
function decideProposedState(opts: {
  currentStatus: string;
  signalKind: HeartbeatEvent["signal_kind"];
  source: ActivitySource;
}): ProposedState | null {
  const { currentStatus, signalKind, source } = opts;

  // Done path — only fires on cloud-lifecycle signals in v1.
  if (
    source === "cloud" &&
    DONE_SIGNAL_KINDS.has(signalKind) &&
    currentStatus === "in_progress"
  ) {
    return "done";
  }

  // In-progress path — any "open"/"focus" signal on an unstarted item.
  if (
    (signalKind === "open" || signalKind === "focus") &&
    (currentStatus === "backlog" ||
      currentStatus === "todo" ||
      currentStatus === "in_queue")
  ) {
    return "in_progress";
  }

  return null;
}

function confidenceFor(opts: {
  matchKind: "source_id" | "source_url" | "description_id";
  proposedState: ProposedState;
  source: ActivitySource;
}): number {
  const { matchKind, proposedState, source } = opts;

  if (proposedState === "done") {
    // Cloud lifecycle is the strongest done signal.
    if (matchKind === "source_id") return 0.99;
    if (matchKind === "source_url") return 0.95;
    return 0.85;
  }

  // in_progress path
  if (matchKind === "source_id") return 0.95;
  if (matchKind === "source_url") return source === "cloud" ? 0.8 : 0.9;
  if (matchKind === "description_id") return 0.85;
  return 0;
}

function reasonHumanFor(opts: {
  event: HeartbeatEvent;
  itemTitle: string;
  matchKind: "source_id" | "source_url" | "description_id";
  proposedState: ProposedState;
}): string {
  const { event, itemTitle, matchKind, proposedState } = opts;
  const surfaceLabel = event.app ?? event.surface ?? "activity";

  if (proposedState === "done") {
    if (matchKind === "source_id") {
      return `${surfaceLabel} reported "${event.signal_kind}" on ${event.identifier}, which is the source of "${itemTitle}".`;
    }
    return `${surfaceLabel} reported "${event.signal_kind}" matching "${itemTitle}".`;
  }

  // in_progress
  if (matchKind === "source_id") {
    return `Active in ${surfaceLabel} on ${event.identifier}, the source for "${itemTitle}".`;
  }
  if (matchKind === "source_url") {
    return `Active on ${event.url}, the source URL for "${itemTitle}".`;
  }
  return `Active in ${surfaceLabel} on ${event.identifier}, referenced by "${itemTitle}".`;
}

/**
 * Has a suggestion already been created for this (item, state) in the last
 * 30 minutes? Used to suppress chatter when the user is mid-task and
 * heartbeats keep firing.
 */
async function isDeduped(opts: {
  userId: string;
  itemId: string;
  proposedState: ProposedState;
}): Promise<boolean> {
  const supabase = createSupabaseServiceClient();
  const sinceIso = new Date(
    Date.now() - DEDUP_WINDOW_MIN * 60 * 1000
  ).toISOString();
  const { data } = await supabase
    .from("activity_suggestions")
    .select("id")
    .eq("user_id", opts.userId)
    .eq("s2d_item_id", opts.itemId)
    .eq("proposed_state", opts.proposedState)
    .gte("created_at", sinceIso)
    .limit(1)
    .maybeSingle();
  return !!data;
}

/**
 * Run the matcher over a batch of events for one user. Inserts qualifying
 * suggestions and returns the count of new rows. Idempotent re-runs are
 * naturally protected by the dedup gate.
 */
export async function runMatcher(opts: {
  userId: string;
  source: ActivitySource;
  eventIdsByInput: Map<HeartbeatEvent, string>;
}): Promise<number> {
  const { userId, source, eventIdsByInput } = opts;
  const supabase = createSupabaseServiceClient();

  const proposals: Array<MatchedSuggestion & { _eventId: string }> = [];

  for (const [event, eventId] of eventIdsByInput.entries()) {
    const candidate = await findCandidateItem({ userId, event });
    if (!candidate) continue;

    const proposedState = decideProposedState({
      currentStatus: candidate.status,
      signalKind: event.signal_kind,
      source,
    });
    if (!proposedState) continue;

    const confidence = confidenceFor({
      matchKind: candidate.match_kind,
      proposedState,
      source,
    });
    if (confidence < MIN_CONFIDENCE) continue;

    if (await isDeduped({ userId, itemId: candidate.id, proposedState })) continue;

    const reason_human = reasonHumanFor({
      event,
      itemTitle: candidate.title,
      matchKind: candidate.match_kind,
      proposedState,
    });

    const signal_kind: MatcherSignalKind =
      proposedState === "done"
        ? "cloud_lifecycle"
        : candidate.match_kind === "source_url"
          ? "url_match"
          : "exact_id";

    const context: SuggestionContext = {
      reason_human,
      event_ids: [eventId],
      signal_snippets: [
        {
          source,
          surface: event.surface,
          title: event.title,
          url: event.url,
          app: event.app,
          when: event.started_at,
        },
      ],
    };

    proposals.push({
      s2d_item_id: candidate.id,
      proposed_state: proposedState,
      confidence,
      signal_kind,
      context,
      _eventId: eventId,
    });
  }

  if (proposals.length === 0) return 0;

  // Service-role insert MUST set user_id explicitly (AGENTS.md multi-tenancy
  // invariants — auth.uid() defaults to NULL under service-role).
  const rows = proposals.map((p) => ({
    user_id: userId,
    s2d_item_id: p.s2d_item_id,
    proposed_state: p.proposed_state,
    confidence: p.confidence,
    signal_kind: p.signal_kind,
    context: p.context,
  }));

  const { error } = await supabase.from("activity_suggestions").insert(rows);
  if (error) {
    console.error("[activity-matcher] insert failed:", error);
    return 0;
  }
  return rows.length;
}
