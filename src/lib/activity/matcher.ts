/**
 * Matcher v2 — turn heartbeat events into activity_suggestions.
 *
 * Match paths, in order of confidence:
 *   - exact_id:       the heartbeat carries an identifier (Linear MAP-123,
 *                     Gmail thread id, Slack channel id, GitHub PR url) that
 *                     matches an s2d_item's source_thread_id.
 *   - url_match:      heartbeat URL matches s2d_item.source_url byte-for-byte
 *                     after canonicalization.
 *   - description_id: identifier appears inside an item's description.
 *   - title_embed:    fuzzy title similarity (Jaccard token overlap, or
 *                     Voyage embedding cosine if VOYAGE_API_KEY is set).
 *                     v2 fallback — fires when none of the above hit.
 *   - cloud_lifecycle: signal_kind in ('close','merge','archive') from a
 *                     cloud source — high-confidence Done indicator.
 *
 * Stage gate: `s2d_items.needs_review = false`. Items still in the review
 * queue are off-limits, per PRD §2 G4.
 *
 * Dedup: don't create a new suggestion for the same (item, proposed_state)
 * within 30 minutes of the most recent one (regardless of status — even a
 * just-rejected suggestion stays quiet).
 *
 * Anti-spam (title_embed only): suppress a fuzzy proposal if the user has
 * REJECTED a title_embed suggestion for the same item in the last 24h.
 * Fuzzy matches are the noisiest tier — explicit rejection is a strong
 * signal we got it wrong on that item, so back off for a day.
 *
 * State-transition rules:
 *   - To propose `in_progress`: item.status IN ('backlog','todo','in_queue')
 *   - To propose `done`:        item.status = 'in_progress'
 *   - title_embed NEVER proposes `done` — too noisy for a destructive-feeling
 *     state change.
 *
 * Confidence floor: per signal kind. Exact-ID / URL / cloud lifecycle stay at
 * 0.85; title_embed drops to 0.5 since it lives in the soft suggestion
 * range per PRD §8 (the UI never auto-promotes anyway — NG1).
 */

import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { log } from "@/lib/log";
import { cosineSimilarity, embed } from "@/lib/embeddings/voyage";
import type {
  ActivitySource,
  HeartbeatEvent,
  MatcherSignalKind,
  ProposedState,
  SuggestionContext,
} from "./types";

const MIN_CONFIDENCE: Record<MatcherSignalKind, number> = {
  exact_id: 0.85,
  url_match: 0.85,
  cloud_lifecycle: 0.85,
  title_embed: 0.5,
};
const DEDUP_WINDOW_MIN = 30;
const TITLE_EMBED_REJECT_BACKOFF_MS = 24 * 60 * 60 * 1000;

// Tuned thresholds for the title-similarity tier. Jaccard on short noisy
// titles is sparse; embeddings are denser so the floor is higher.
const JACCARD_THRESHOLD = 0.4;
const VOYAGE_THRESHOLD = 0.65;
// Cap on how many candidate items we score per event. Bounded so the
// fuzzy path stays cheap even for users with deep backlogs.
const TITLE_CANDIDATE_LIMIT = 50;

// Stopwords + min token length picked to wipe out noise in 3-7 word
// task titles without nuking signal-bearing short tokens (e.g. "S2D",
// "API" survive because they're uppercased and the length filter
// kicks in AFTER lowercasing).
const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "of",
  "to",
  "in",
  "on",
  "for",
  "at",
  "by",
  "with",
  "is",
  "are",
  "was",
  "were",
  "this",
  "that",
]);

// Cloud-lifecycle signals that imply "Done"
const DONE_SIGNAL_KINDS = new Set(["close", "merge", "archive"]);

type MatchKind = "source_id" | "source_url" | "description_id" | "title_embed";

interface MatchedSuggestion {
  s2d_item_id: string;
  proposed_state: ProposedState;
  confidence: number;
  signal_kind: MatcherSignalKind;
  context: SuggestionContext;
}

interface CandidateItem {
  id: string;
  status: string;
  title: string;
  match_kind: MatchKind;
  // Only present for title_embed matches; lets callers log the score.
  similarity?: number;
  embed_mode?: "jaccard" | "voyage";
}

/**
 * Normalize a title into a token set for Jaccard. Lowercase, strip
 * punctuation to spaces (so `cursor.tsx` → `cursor tsx`), drop stop
 * words, drop tokens of length ≤ 2 (kills "a", "of", and noise like
 * "vs").
 */
function tokenize(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
  return new Set(tokens);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersect = 0;
  for (const t of a) if (b.has(t)) intersect++;
  const union = a.size + b.size - intersect;
  if (union === 0) return 0;
  return intersect / union;
}

/**
 * Fuzzy title-similarity candidate finder. Used as the 4th match path.
 *
 * Scoring strategy:
 *   - If `VOYAGE_API_KEY` is set: batch-embed the event title + all
 *     candidate titles, compare via cosine, threshold at 0.65.
 *   - Otherwise: Jaccard token overlap, threshold at 0.4.
 *
 * Returns the single highest-scoring candidate above threshold, or null.
 */
async function findTitleSimilarItem(opts: {
  userId: string;
  eventTitle: string;
}): Promise<CandidateItem | null> {
  const { userId, eventTitle } = opts;
  const supabase = createSupabaseServiceClient();

  // Pull recently-active items. We deliberately drop items in `done` so
  // we don't propose advancing an already-done thing. `needs_review =
  // false` keeps the stage gate honest.
  const { data: items } = await supabase
    .from("s2d_items")
    .select("id, status, title")
    .eq("user_id", userId)
    .eq("needs_review", false)
    .neq("status", "done")
    .order("updated_at", { ascending: false })
    .limit(TITLE_CANDIDATE_LIMIT);

  if (!items || items.length === 0) return null;

  const useVoyage = !!process.env.VOYAGE_API_KEY;

  let bestId: string | null = null;
  let bestStatus = "";
  let bestTitle = "";
  let bestScore = 0;
  let mode: "jaccard" | "voyage" = "jaccard";

  if (useVoyage) {
    try {
      // Batch: [eventTitle, ...candidateTitles]. One round-trip even
      // when scoring 50 items.
      const vectors = await embed([eventTitle, ...items.map((i) => i.title)]);
      const eventVec = vectors[0];
      for (let i = 0; i < items.length; i++) {
        const score = cosineSimilarity(eventVec, vectors[i + 1]);
        if (score > bestScore) {
          bestScore = score;
          bestId = items[i].id;
          bestStatus = items[i].status;
          bestTitle = items[i].title;
        }
      }
      mode = "voyage";
      if (bestScore < VOYAGE_THRESHOLD) return null;
    } catch (err) {
      // Voyage failure must not poison the matcher run — fall back to
      // Jaccard. Reset best-of-* trackers because Voyage may have
      // partially populated them.
      log.warn("activity_matcher.voyage_fallback", {
        message: err instanceof Error ? err.message : String(err),
      });
      bestId = null;
      bestStatus = "";
      bestTitle = "";
      bestScore = 0;
      mode = "jaccard";
    }
  }

  if (mode === "jaccard") {
    const eventTokens = tokenize(eventTitle);
    if (eventTokens.size === 0) return null;
    for (const item of items) {
      const score = jaccard(eventTokens, tokenize(item.title));
      if (score > bestScore) {
        bestScore = score;
        bestId = item.id;
        bestStatus = item.status;
        bestTitle = item.title;
      }
    }
    if (bestScore < JACCARD_THRESHOLD) return null;
  }

  if (!bestId) return null;

  return {
    id: bestId,
    status: bestStatus,
    title: bestTitle,
    match_kind: "title_embed",
    similarity: bestScore,
    embed_mode: mode,
  };
}

/**
 * Find candidate s2d_items the user owns that could correspond to the
 * heartbeat event. Returns at most one match — multi-match resolution is
 * intentionally absent (better quiet than wrong).
 *
 * Tries paths in confidence order: source_thread_id → source_url →
 * description-mentions-id → title-similarity. First hit wins.
 */
async function findCandidateItem(opts: {
  userId: string;
  event: HeartbeatEvent;
}): Promise<CandidateItem | null> {
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

  // 4. Fuzzy title-similarity match — only when we have a title to compare.
  if (event.title && event.title.trim().length > 0) {
    const candidate = await findTitleSimilarItem({
      userId,
      eventTitle: event.title,
    });
    if (candidate) return candidate;
  }

  return null;
}

/**
 * Hosts whose URLs encode meaningful identity in the fragment (#...).
 * For these we MUST preserve the fragment during canonicalization,
 * otherwise distinct resources collapse to the same canonical URL.
 *
 * Gmail is the load-bearing example: `https://mail.google.com/mail/u/0/#all/<threadId>`
 * — strip the fragment and every Gmail thread becomes the same string.
 *
 * Match on hostname suffix so subdomains (mail.google.com,
 * github.com/<user>/<repo>) are covered without listing each one.
 */
const FRAGMENT_BEARING_HOSTS = ["mail.google.com"];

/**
 * Drop tracking params, trailing slashes, and (usually) fragments.
 * Keeps schemes + paths stable so equality compares meaningfully.
 *
 * Fragments are kept on hosts that encode identity in them
 * (see FRAGMENT_BEARING_HOSTS). For everything else we strip — most
 * fragments are scroll positions or section anchors, not identity.
 */
export function canonicalize(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl);
    const hostKeepsFragment = FRAGMENT_BEARING_HOSTS.some(
      (h) => u.hostname === h || u.hostname.endsWith(`.${h}`)
    );
    if (!hostKeepsFragment) {
      u.hash = "";
    }
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
 * Per-user ignore lists. Loaded once per matcher invocation (batch lookup)
 * so we don't hit the DB once per event.
 *
 * Domains are lower-cased on load; we compare against the URL's lower-cased
 * hostname with both equality and suffix (`.${domain}`) match so a single
 * entry `chase.com` covers `www.chase.com`, `secure.chase.com`, etc.
 *
 * Multi-tenancy: the read filters by user_id explicitly per AGENTS.md.
 */
async function loadIgnoreLists(
  userId: string
): Promise<{ apps: Set<string>; domains: string[] }> {
  const supabase = createSupabaseServiceClient();
  const { data } = await supabase
    .from("activity_settings")
    .select("ignore_apps, ignore_domains")
    .eq("user_id", userId)
    .maybeSingle();

  const apps = new Set<string>(
    Array.isArray(data?.ignore_apps) ? (data?.ignore_apps as string[]) : []
  );
  const domainsRaw = Array.isArray(data?.ignore_domains)
    ? (data?.ignore_domains as string[])
    : [];
  const domains = domainsRaw
    .map((d) => d.trim().toLowerCase())
    .filter((d) => d.length > 0);

  return { apps, domains };
}

/**
 * Should the matcher skip this event because the user has the app or
 * the URL's host on an ignore list?
 *
 * Returns the reason string when skipping, null otherwise. Caller logs.
 */
function shouldIgnore(
  event: HeartbeatEvent,
  ignore: { apps: Set<string>; domains: string[] }
): string | null {
  if (event.app && ignore.apps.has(event.app)) {
    return `app:${event.app}`;
  }
  if (event.url && ignore.domains.length > 0) {
    let host: string | null = null;
    try {
      host = new URL(event.url).hostname.toLowerCase();
    } catch {
      // Unparseable URL — fall through, no ignore match.
    }
    if (host) {
      for (const domain of ignore.domains) {
        if (host === domain || host.endsWith(`.${domain}`)) {
          return `domain:${domain}`;
        }
      }
    }
  }
  return null;
}

/**
 * What state transition is plausible given an item's current status and the
 * incoming signal?
 *   - `in_progress` proposal makes sense when the item is unstarted
 *     ('backlog' | 'todo' | 'in_queue') and the signal is a working signal.
 *   - `done` proposal makes sense when the item is currently 'in_progress'
 *     and the signal is a completion signal (close/merge/archive from
 *     cloud).
 *
 * title_embed callers also gate this through `proposedState === "done"`
 * being disallowed at a higher level — see runMatcher.
 */
function decideProposedState(opts: {
  currentStatus: string;
  signalKind: HeartbeatEvent["signal_kind"];
  source: ActivitySource;
}): ProposedState | null {
  const { currentStatus, signalKind, source } = opts;

  // Done path — only fires on cloud-lifecycle signals.
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
  matchKind: MatchKind;
  proposedState: ProposedState;
  source: ActivitySource;
  similarity?: number;
}): number {
  const { matchKind, proposedState, source, similarity } = opts;

  if (proposedState === "done") {
    // Cloud lifecycle is the strongest done signal.
    if (matchKind === "source_id") return 0.99;
    if (matchKind === "source_url") return 0.95;
    if (matchKind === "description_id") return 0.85;
    // title_embed never produces a `done` proposal — runMatcher gates.
    return 0;
  }

  // in_progress path
  if (matchKind === "source_id") return 0.95;
  if (matchKind === "source_url") return source === "cloud" ? 0.8 : 0.9;
  if (matchKind === "description_id") return 0.85;
  if (matchKind === "title_embed") {
    // Scale 0.5 → 0.7 across the threshold-to-perfect range. Use the
    // active threshold so Voyage's denser scoring doesn't get
    // artificially capped at the Jaccard ceiling.
    const sim = similarity ?? 0;
    const threshold = process.env.VOYAGE_API_KEY
      ? VOYAGE_THRESHOLD
      : JACCARD_THRESHOLD;
    if (sim < threshold) return 0;
    const scaled = 0.5 + (0.2 * (sim - threshold)) / (1 - threshold);
    return Math.min(0.7, scaled);
  }
  return 0;
}

function reasonHumanFor(opts: {
  event: HeartbeatEvent;
  itemTitle: string;
  matchKind: MatchKind;
  proposedState: ProposedState;
  similarity?: number;
}): string {
  const { event, itemTitle, matchKind, proposedState, similarity } = opts;
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
  if (matchKind === "title_embed") {
    const pct = similarity ? Math.round(similarity * 100) : 0;
    return `Active on "${event.title}" in ${surfaceLabel} — ${pct}% title match with "${itemTitle}".`;
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
 * Has the user rejected a title_embed suggestion for this item in the
 * past 24 hours? Title-similarity is the noisiest tier and an explicit
 * rejection is a strong signal we got it wrong on this pair. The
 * 30-minute dedup gate covers same-state within the window; this is the
 * broader back-off for fuzzy matches specifically.
 */
async function isRecentlyRejectedTitleEmbed(opts: {
  userId: string;
  itemId: string;
}): Promise<boolean> {
  const supabase = createSupabaseServiceClient();
  const sinceIso = new Date(
    Date.now() - TITLE_EMBED_REJECT_BACKOFF_MS
  ).toISOString();
  const { data } = await supabase
    .from("activity_suggestions")
    .select("id")
    .eq("user_id", opts.userId)
    .eq("s2d_item_id", opts.itemId)
    .eq("signal_kind", "title_embed")
    .eq("status", "rejected")
    .gte("decided_at", sinceIso)
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

  // Load ignore lists once per invocation. Cheap (single row), and lets us
  // short-circuit per-event without any further DB work for ignored apps /
  // domains.
  const ignore = await loadIgnoreLists(userId);

  const proposals: Array<MatchedSuggestion & { _eventId: string }> = [];

  for (const [event, eventId] of eventIdsByInput.entries()) {
    const ignoreReason = shouldIgnore(event, ignore);
    if (ignoreReason) {
      // Quiet path — event still landed in activity_events for forensics,
      // we just don't propose anything. Low-noise debug line for tracing
      // false negatives without spamming prod logs.
      console.debug(
        `[activity-matcher] skip ${ignoreReason} (event ${eventId})`
      );
      continue;
    }

    const candidate = await findCandidateItem({ userId, event });
    if (!candidate) continue;

    const proposedState = decideProposedState({
      currentStatus: candidate.status,
      signalKind: event.signal_kind,
      source,
    });
    if (!proposedState) continue;

    // title_embed is never allowed to propose `done` — too noisy for a
    // destructive-looking state change per PRD §8 + spec for v2.
    if (candidate.match_kind === "title_embed" && proposedState === "done") {
      continue;
    }

    const confidence = confidenceFor({
      matchKind: candidate.match_kind,
      proposedState,
      source,
      similarity: candidate.similarity,
    });

    // Per-signal-kind floor. title_embed sits in the soft suggestion
    // range (0.5–0.7); everything else stays at 0.85.
    const signal_kind: MatcherSignalKind =
      candidate.match_kind === "title_embed"
        ? "title_embed"
        : proposedState === "done"
          ? "cloud_lifecycle"
          : candidate.match_kind === "source_url"
            ? "url_match"
            : "exact_id";

    if (confidence < MIN_CONFIDENCE[signal_kind]) continue;

    if (await isDeduped({ userId, itemId: candidate.id, proposedState })) continue;

    // Extra safety on the fuzzy path: a recent rejection means the user
    // already told us this match is wrong. Stay quiet for 24h.
    if (signal_kind === "title_embed") {
      if (
        await isRecentlyRejectedTitleEmbed({
          userId,
          itemId: candidate.id,
        })
      ) {
        continue;
      }
      log.info("activity_matcher.title_embed_match", {
        user_id: userId,
        event_id: eventId,
        item_id: candidate.id,
        similarity: candidate.similarity,
        mode: candidate.embed_mode,
        confidence,
      });
    }

    const reason_human = reasonHumanFor({
      event,
      itemTitle: candidate.title,
      matchKind: candidate.match_kind,
      proposedState,
      similarity: candidate.similarity,
    });

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
    log.error("activity_matcher.insert_failed", {
      user_id: userId,
      source,
      row_count: rows.length,
      message: error.message,
    });
    return 0;
  }
  return rows.length;
}
