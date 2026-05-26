import type { SupabaseClient } from "@supabase/supabase-js";
import type { S2DItem } from "@/types";

/**
 * Meeting-match: pick candidate calendar_events that this s2d_item
 * could legitimately be prepped for. Used by the MeetingPrepCanvas
 * pre-warm and by the canvas itself when the user hasn't selected
 * a meeting yet.
 *
 * Heuristic, in order:
 *   1. If `item.calendar_event_id` is set, surface that event first.
 *   2. Otherwise score upcoming events (next 14 days) by:
 *        - token overlap between event.title and item.title
 *        - attendee overlap between event.attendees and any people
 *          mentioned in item.title / description
 *
 * Returns events sorted by score desc, capped at `limit`. Scope is
 * always the calling user — every query filters by `userId`.
 */

export interface CandidateMeeting {
  id: string;
  external_id: string | null;
  title: string;
  start_at: string;
  end_at: string;
  attendees: Array<{ email?: string; name?: string | null }>;
  location: string | null;
  meeting_url: string | null;
  score: number;
}

interface CalRow {
  id: string;
  external_id: string | null;
  title: string | null;
  start_at: string;
  end_at: string;
  attendees: unknown;
  location: string | null;
  meeting_url: string | null;
}

interface MatchOpts {
  sb: SupabaseClient;
  userId: string;
  item: Pick<
    S2DItem,
    "id" | "title" | "description" | "source_type" | "source_thread_id" | "company"
  >;
  lookaheadDays?: number;
  limit?: number;
}

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "for",
  "with",
  "on",
  "in",
  "to",
  "at",
  "by",
  "from",
  "is",
  "are",
  "be",
  "this",
  "that",
  "it",
  "we",
  "you",
  "i",
  "as",
  "vs",
  "re",
]);

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2 && !STOPWORDS.has(t))
  );
}

function asAttendees(
  v: unknown
): Array<{ email?: string; name?: string | null }> {
  if (!Array.isArray(v)) return [];
  return v.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const r = row as { email?: unknown; name?: unknown };
    return [
      {
        email: typeof r.email === "string" ? r.email : undefined,
        name:
          typeof r.name === "string"
            ? r.name
            : r.name === null
              ? null
              : undefined,
      },
    ];
  });
}

export async function findCandidateMeetings({
  sb,
  userId,
  item,
  lookaheadDays = 14,
  limit = 8,
}: MatchOpts): Promise<CandidateMeeting[]> {
  const nowIso = new Date().toISOString();
  const horizonIso = new Date(
    Date.now() + lookaheadDays * 86_400_000
  ).toISOString();

  const { data: rows } = await sb
    .from("calendar_events")
    .select(
      "id, external_id, title, start_at, end_at, attendees, location, meeting_url"
    )
    .eq("user_id", userId)
    .gte("start_at", nowIso)
    .lte("start_at", horizonIso)
    .order("start_at", { ascending: true })
    .limit(80);

  const events = (rows as CalRow[] | null) ?? [];

  const itemTokens = tokenize(
    [item.title, item.description ?? "", item.company?.name ?? ""].join(" ")
  );

  // meeting-backed items often arrive with the upstream calendar event id
  // already attached as `source_thread_id` (source_type='calendar') — pin
  // that meeting at the top of the candidate list so the canvas defaults
  // to the one the user almost certainly intends.
  const pinnedId =
    item.source_type === "calendar" ? item.source_thread_id ?? null : null;

  const scored: CandidateMeeting[] = events.map((ev) => {
    const attendees = asAttendees(ev.attendees);
    const evTokens = tokenize(ev.title ?? "");
    let titleOverlap = 0;
    for (const t of evTokens) if (itemTokens.has(t)) titleOverlap++;
    let attendeeOverlap = 0;
    for (const a of attendees) {
      const name = (a.name ?? "").toLowerCase();
      const email = (a.email ?? "").toLowerCase();
      if (!name && !email) continue;
      for (const t of itemTokens) {
        if (t.length < 3) continue;
        if (name.includes(t) || email.includes(t)) {
          attendeeOverlap++;
          break;
        }
      }
    }
    const score =
      (pinnedId && ev.external_id === pinnedId ? 100 : 0) +
      titleOverlap * 3 +
      attendeeOverlap * 2;
    return {
      id: ev.id,
      external_id: ev.external_id,
      title: ev.title ?? "(no title)",
      start_at: ev.start_at,
      end_at: ev.end_at,
      attendees,
      location: ev.location,
      meeting_url: ev.meeting_url,
      score,
    };
  });

  scored.sort((a, b) => b.score - a.score);
  // Drop zero-scored events when we have any positive match; otherwise
  // surface the soonest few so the canvas isn't empty for low-signal items.
  const positive = scored.filter((c) => c.score > 0);
  if (positive.length > 0) return positive.slice(0, limit);
  return scored.slice(0, Math.min(limit, 4));
}
