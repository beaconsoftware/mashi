import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Reference resolver — Phase 4.
 *
 * The agent's Spotlight surface lets the user reference an item without
 * a ticket id ("the brand spend thing"). `resolveReference` returns
 * ranked candidates the model can either auto-pick (high confidence,
 * single match) or render as a candidate list for the user.
 *
 * Strategy, in order:
 *   1. Ticket-number match (MASH-1408, 1408, "ticket 1408"). Definitive
 *      — when this hits, no other strategies run.
 *   2. Exact title equality (case-insensitive). High confidence.
 *   3. Token-overlap ranking against title + description + outcome.
 *      Multiple tokens overlapping all the way through is scored higher
 *      than a single hit.
 *   4. Recency bonus + cursor.recentlyViewedItemIds bonus blend into
 *      the final score.
 *
 * Vector similarity over pulled-source content is deferred — the token
 * overlap pass is usually enough for the kind of references a user
 * types in conversation.
 */

export interface ResolveCandidate {
  id: string;
  ticket_number: number | null;
  title: string;
  pathway: string | null;
  status: string;
  priority: string | null;
  updated_at: string;
  /** 0-1 confidence. 0.99 = ticket-number / exact-title hit; 0.7-0.95
   * is solid token overlap; below 0.5 is best-guess noise. */
  confidence: number;
  /** Why this candidate matched — surfaced to the user when the agent
   * renders the candidate-list card. */
  match_reason: string;
}

export interface ResolveOptions {
  /** Bias toward items the user recently touched. From cursor context. */
  recentlyViewedItemIds?: string[];
  /** Cap on returned candidates. Default 5; the agent picks the top
   * candidate if confidence is high or asks the user otherwise. */
  max?: number;
}

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "of",
  "to",
  "for",
  "in",
  "on",
  "at",
  "by",
  "with",
  "about",
  "that",
  "this",
  "these",
  "those",
  "thing",
  "stuff",
  "item",
  "ticket",
  "task",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "what",
  "who",
  "where",
  "when",
  "why",
  "how",
  "from",
  "into",
  "do",
  "did",
  "does",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

function extractTicketNumber(text: string): number | null {
  // MASH-1408 or mash-1408
  const m1 = text.match(/\bMASH-(\d+)\b/i);
  if (m1) return Number(m1[1]);
  // "ticket 1408", "#1408"
  const m2 = text.match(/(?:^|\s|#)(\d{1,6})\b/);
  if (m2) return Number(m2[1]);
  return null;
}

interface CandidateRow {
  id: string;
  ticket_number: number | null;
  title: string;
  description: string | null;
  outcome: string | null;
  pathway: string | null;
  status: string;
  priority: string | null;
  updated_at: string;
}

export async function resolveReference(opts: {
  text: string;
  userId: string;
  supabase: SupabaseClient;
  recentlyViewedItemIds?: string[];
  max?: number;
}): Promise<ResolveCandidate[]> {
  const max = Math.min(Math.max(opts.max ?? 5, 1), 20);
  const text = opts.text.trim();
  if (!text) return [];

  const recents = new Set(opts.recentlyViewedItemIds ?? []);

  // Pass 1 — ticket number. When present, we trust it absolutely.
  const ticketNum = extractTicketNumber(text);
  if (ticketNum != null) {
    const { data } = await opts.supabase
      .from("s2d_items")
      .select(
        "id, ticket_number, title, description, outcome, pathway, status, priority, updated_at"
      )
      .eq("user_id", opts.userId)
      .eq("ticket_number", ticketNum)
      .maybeSingle();
    if (data) {
      const row = data as CandidateRow;
      return [
        {
          id: row.id,
          ticket_number: row.ticket_number,
          title: row.title,
          pathway: row.pathway,
          status: row.status,
          priority: row.priority,
          updated_at: row.updated_at,
          confidence: 0.99,
          match_reason: `Ticket number MASH-${row.ticket_number}`,
        },
      ];
    }
    // Fall through if no such ticket exists — text may also contain a
    // free-text phrase the user wants us to resolve.
  }

  // Pull a candidate set big enough to rank meaningfully. We sort by
  // updated_at DESC server-side so recency falls out naturally; the
  // ranker re-weights with token overlap + cursor bias.
  const { data, error } = await opts.supabase
    .from("s2d_items")
    .select(
      "id, ticket_number, title, description, outcome, pathway, status, priority, updated_at"
    )
    .eq("user_id", opts.userId)
    .order("updated_at", { ascending: false })
    .limit(400);
  if (error) throw error;
  const rows = (data ?? []) as CandidateRow[];
  if (rows.length === 0) return [];

  const queryLower = text.toLowerCase();
  const queryTokens = tokenize(text);

  const now = Date.now();
  const scored: ResolveCandidate[] = [];

  for (const row of rows) {
    const titleLower = row.title.toLowerCase();

    // Exact title equality — bypass everything else, near-certain.
    if (titleLower === queryLower) {
      scored.push({
        id: row.id,
        ticket_number: row.ticket_number,
        title: row.title,
        pathway: row.pathway,
        status: row.status,
        priority: row.priority,
        updated_at: row.updated_at,
        confidence: 0.98,
        match_reason: "Exact title match",
      });
      continue;
    }

    // Exact title contains the full query (e.g. user typed "brand
    // spend" and the title is "Approve Q4 brand spend").
    const titleContainsFullQuery =
      queryLower.length >= 3 && titleLower.includes(queryLower);

    // Token overlap.
    const hay = [
      row.title,
      row.description ?? "",
      row.outcome ?? "",
    ]
      .join(" ")
      .toLowerCase();
    const titleHay = titleLower;

    let titleHits = 0;
    let bodyHits = 0;
    for (const t of queryTokens) {
      if (titleHay.includes(t)) titleHits += 1;
      else if (hay.includes(t)) bodyHits += 1;
    }

    if (
      !titleContainsFullQuery &&
      titleHits === 0 &&
      bodyHits === 0
    ) {
      continue;
    }

    const totalTokens = Math.max(queryTokens.length, 1);
    const overlap = (titleHits * 1.5 + bodyHits) / (totalTokens * 1.5);
    // Title-substring hit dominates token math when both fire.
    const baseScore = titleContainsFullQuery
      ? Math.max(0.7, overlap)
      : overlap;

    // Recency bonus: 0 (stale, >30 days) → 0.05 (touched today).
    const ageDays = Math.max(
      0,
      (now - new Date(row.updated_at).getTime()) / (1000 * 60 * 60 * 24)
    );
    const recencyBonus = Math.max(0, 0.05 - (ageDays / 30) * 0.05);

    // Cursor bias: items the user just looked at deserve extra credit.
    const cursorBonus = recents.has(row.id) ? 0.1 : 0;

    const confidence = Math.min(0.95, baseScore + recencyBonus + cursorBonus);
    if (confidence < 0.2) continue;

    const reasonParts: string[] = [];
    if (titleContainsFullQuery) reasonParts.push("title contains your phrase");
    else if (titleHits > 0) reasonParts.push(`${titleHits} title token${titleHits === 1 ? "" : "s"} match`);
    if (bodyHits > 0) reasonParts.push(`${bodyHits} body token${bodyHits === 1 ? "" : "s"} match`);
    if (cursorBonus > 0) reasonParts.push("recently viewed");

    scored.push({
      id: row.id,
      ticket_number: row.ticket_number,
      title: row.title,
      pathway: row.pathway,
      status: row.status,
      priority: row.priority,
      updated_at: row.updated_at,
      confidence,
      match_reason: reasonParts.join(", ") || "ranked by overlap",
    });
  }

  scored.sort((a, b) => b.confidence - a.confidence);
  return scored.slice(0, max);
}
