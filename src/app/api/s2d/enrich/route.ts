import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";
import { MODELS } from "@/lib/anthropic/client";
import { trackedCreate } from "@/lib/anthropic/tracked";
import { getActiveAccessToken } from "@/lib/oauth/flow";
import { getUserContext } from "@/lib/user-context";
import type { Pathway, Priority, S2DStatus } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/s2d/enrich
 * Body: { placeholder: string, companyId?: string }
 *
 * The user typed a rough idea. Mashi:
 *   1. Searches the local DB for related Fireflies meetings, Gmail
 *      threads, Linear issues, and Slack messages.
 *   2. If nothing's there OR the matches are thin, optionally pulls
 *      live from Fireflies' search API to fill the gap.
 *   3. Hands the assembled context + placeholder to Sonnet to produce a
 *      refined title, description, pathway, priority, est_minutes, and
 *      a company recommendation.
 *
 * Returns the enriched draft for the user to review (still goes through
 * the Review column on save, since this is an AI-created item).
 */

interface ReqBody {
  placeholder?: string;
  companyId?: string | null;
}

interface EnrichedDraft {
  title: string;
  description: string;
  pathway: Pathway;
  priority: Priority;
  status: S2DStatus;
  est_minutes: number | null;
  company_id: string | null;
  rationale: string;
  context_used: Array<{
    source: "s2d" | "fireflies" | "gmail" | "slack" | "linear" | "live_fireflies";
    label: string;
    snippet: string;
    when?: string;
  }>;
}

/**
 * Common English stop-words + a handful of meeting/task glue words that
 * eat up matches without adding signal. The 'and's, 'the's, 'for's of
 * the world are the difference between a 70-char ILIKE that matches
 * nothing and a keyword set that ranks meaningful overlap.
 */
const STOPWORDS = new Set([
  "a","an","the","and","or","but","if","then","so","because","of","for","to","in","on","at","with","by","from",
  "is","are","was","were","be","been","being","have","has","had","do","does","did","will","would","should","can",
  "could","this","that","these","those","it","its","as","not","also","just","about","via","per","into","onto",
  "out","up","down","over","under","more","less","new","old","status","data","quality","check","review","update",
]);

/**
 * Tokenize a placeholder into searchable keywords:
 *   - lowercase, split on non-word chars
 *   - drop stop-words and tokens shorter than 3 chars
 *   - de-dupe
 *
 * Picks up "scraper", "SERP", "API", "MAP", "Policy", "Partners" from
 * "Assess SERP API scraper status and data quality for MAP Policy
 * Partners" — exactly the words that match the existing MPP scraper
 * tickets the user expected to see surfaced.
 */
function extractKeywords(placeholder: string): string[] {
  const tokens = placeholder
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
  return [...new Set(tokens)];
}

/**
 * Score each row by how many distinct keywords appear in its haystack
 * (concatenated searchable fields). Higher score → more relevant.
 * Tie-break by recency via the caller's ordering.
 */
function scoreByKeywords(haystack: string, keywords: string[]): number {
  const h = haystack.toLowerCase();
  let n = 0;
  for (const kw of keywords) if (h.includes(kw)) n += 1;
  return n;
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as ReqBody;
  const placeholder = (body.placeholder ?? "").trim();
  if (placeholder.length < 3) {
    return NextResponse.json({ error: "Type at least a few words first" }, { status: 400 });
  }

  const userSb = await createSupabaseServerClient();
  const {
    data: { user },
  } = await userSb.auth.getUser();
  if (!user) return new Response("unauthorized", { status: 401 });

  const sb = createSupabaseServiceClient();

  // Every query below is scoped to user.id — service-role bypasses RLS,
  // so without this filter the local-context search could pull rows from
  // another tenant's meetings/messages/linear_issues and bleed them into
  // the enrichment prompt.
  const local = await searchLocal(sb, placeholder, body.companyId ?? null, user.id);

  let liveHits: EnrichedDraft["context_used"] = [];
  if (local.length < 3) {
    try {
      liveHits = await searchLiveFireflies(sb, placeholder, user.id);
    } catch (err) {
      console.warn("[enrich] live fireflies search failed:", err);
    }
  }

  const contextUsed = [...local, ...liveHits].slice(0, 8);

  const userCtx = await getUserContext(user.id);

  // 3. Hand to Sonnet for the actual enrichment
  const draft = await enrichWithSonnet(
    placeholder,
    body.companyId ?? null,
    contextUsed,
    userCtx.firstName
  );

  return NextResponse.json({ draft, contextUsed });
}

type SB = ReturnType<typeof createSupabaseServiceClient>;

/**
 * Build a PostgREST `.or(...)` clause from a set of keywords and a list
 * of column names. Each keyword × column pair becomes a separate
 * `col.ilike.%kw%` term, all OR'd together. Empty keyword list returns
 * null so the caller can skip the filter entirely.
 */
function ilikeOrClause(columns: string[], keywords: string[]): string | null {
  if (keywords.length === 0) return null;
  const parts: string[] = [];
  for (const col of columns) {
    for (const kw of keywords) {
      // Escape PostgREST OR-list delimiters in the keyword. Stop-word /
      // tokenizer above already strips % and , by construction, but
      // future tokenizer changes shouldn't break the query.
      const safe = kw.replace(/[,()]/g, "");
      if (safe) parts.push(`${col}.ilike.%${safe}%`);
    }
  }
  return parts.join(",");
}

async function searchLocal(
  sb: SB,
  placeholder: string,
  companyId: string | null,
  userId: string
): Promise<EnrichedDraft["context_used"]> {
  const keywords = extractKeywords(placeholder);
  if (keywords.length === 0) return [];

  const out: EnrichedDraft["context_used"] = [];

  // S2D items the user already has on the board (or recently closed).
  // This is the source the previous version missed entirely — meaning a
  // near-duplicate placeholder of an existing ticket returned "NO
  // RELATED CONTEXT FOUND" despite the ticket sitting on the board.
  //
  // We fetch a wider set (50) per keyword OR, then score in-memory by
  // how many distinct keywords match the item's haystack, and keep the
  // top 5. Recent + multi-keyword hits dominate.
  const s2dOr = ilikeOrClause(["title", "description"], keywords);
  if (s2dOr) {
    let q = sb
      .from("s2d_items")
      .select("id, ticket_number, title, description, status, updated_at, done_at")
      .eq("user_id", userId)
      .or(s2dOr)
      .order("updated_at", { ascending: false })
      .limit(50);
    if (companyId) q = q.eq("company_id", companyId);
    const { data: rows } = await q;
    const ranked = (rows ?? [])
      .map((r) => ({
        row: r,
        score: scoreByKeywords(`${r.title ?? ""} ${r.description ?? ""}`, keywords),
      }))
      .filter((x) => x.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const ta = a.row.updated_at ?? "";
        const tb = b.row.updated_at ?? "";
        return tb.localeCompare(ta);
      })
      .slice(0, 5);
    for (const { row: r } of ranked) {
      const ticket = r.ticket_number != null ? `MASH-${r.ticket_number} · ` : "";
      out.push({
        source: "s2d",
        label: `${ticket}${r.title} (${r.status ?? "?"})`.slice(0, 140),
        snippet: (r.description ?? "").slice(0, 400),
        when: r.done_at ?? r.updated_at ?? undefined,
      });
    }
  }

  // Fireflies meetings — user-scoped
  const mtgOr = ilikeOrClause(["title", "summary"], keywords);
  if (mtgOr) {
    let meetings = sb
      .from("meetings")
      .select("title, date, summary")
      .eq("user_id", userId)
      .or(mtgOr)
      .order("date", { ascending: false })
      .limit(4);
    if (companyId) meetings = meetings.eq("company_id", companyId);
    const { data: mtgs } = await meetings;
    for (const m of mtgs ?? []) {
      out.push({
        source: "fireflies",
        label: m.title ?? "(untitled meeting)",
        snippet: (m.summary ?? "").slice(0, 400),
        when: m.date ?? undefined,
      });
    }
  }

  // Linear issues — user-scoped
  const issueOr = ilikeOrClause(["title", "description"], keywords);
  if (issueOr) {
    let issues = sb
      .from("linear_issues")
      .select("title, description, status, updated_at")
      .eq("user_id", userId)
      .or(issueOr)
      .order("updated_at", { ascending: false })
      .limit(3);
    if (companyId) issues = issues.eq("company_id", companyId);
    const { data: iss } = await issues;
    for (const i of iss ?? []) {
      out.push({
        source: "linear",
        label: `${i.title} (${i.status ?? "?"})`,
        snippet: (i.description ?? "").slice(0, 400),
        when: i.updated_at ?? undefined,
      });
    }
  }

  // Messages (gmail + slack) — user-scoped
  const msgOr = ilikeOrClause(["subject", "full_content", "preview"], keywords);
  if (msgOr) {
    let msgs = sb
      .from("messages")
      .select("source, subject, sender_name, full_content, preview, received_at")
      .eq("user_id", userId)
      .or(msgOr)
      .order("received_at", { ascending: false })
      .limit(4);
    if (companyId) msgs = msgs.eq("company_id", companyId);
    const { data: mm } = await msgs;
    for (const m of mm ?? []) {
      out.push({
        source: m.source === "slack" ? "slack" : "gmail",
        label: `${m.sender_name ?? "?"}: ${m.subject ?? ""}`.slice(0, 120),
        snippet: (m.full_content ?? m.preview ?? "").slice(0, 400),
        when: m.received_at ?? undefined,
      });
    }
  }

  return out;
}

const FF_GRAPHQL = "https://api.fireflies.ai/graphql";

async function searchLiveFireflies(
  sb: SB,
  query: string,
  userId: string
): Promise<EnrichedDraft["context_used"]> {
  const { data: ff } = await sb
    .from("connected_accounts")
    .select("id")
    .eq("user_id", userId)
    .eq("provider", "fireflies")
    .limit(1)
    .maybeSingle();
  if (!ff?.id) return [];
  const token = await getActiveAccessToken(ff.id);

  const gql = `
    query Search($q: String!) {
      transcripts(filter: { keyword: $q }, limit: 3) {
        id title date_string
        summary { keywords short_summary }
      }
    }
  `;
  const res = await fetch(FF_GRAPHQL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: gql, variables: { q: query } }),
  });
  if (!res.ok) return [];
  const j = (await res.json()) as {
    data?: {
      transcripts?: Array<{
        id: string;
        title: string;
        date_string?: string;
        summary?: { keywords?: string[]; short_summary?: string };
      }>;
    };
  };
  const out: EnrichedDraft["context_used"] = [];
  for (const t of j.data?.transcripts ?? []) {
    out.push({
      source: "live_fireflies",
      label: t.title,
      snippet: (t.summary?.short_summary ?? "").slice(0, 400),
      when: t.date_string,
    });
  }
  return out;
}

async function enrichWithSonnet(
  placeholder: string,
  companyId: string | null,
  contextUsed: EnrichedDraft["context_used"],
  userName: string
): Promise<EnrichedDraft> {
  const today = new Date().toISOString().slice(0, 10);

  const contextBlock =
    contextUsed.length === 0
      ? "(no related context found — work from the placeholder alone)"
      : contextUsed
          .map(
            (c, i) =>
              `${i + 1}. [${c.source}${c.when ? ` · ${c.when.slice(0, 10)}` : ""}] ${c.label}\n   ${c.snippet}`
          )
          .join("\n\n");

  const system = `You enrich rough task placeholders that ${userName} jots down into well-formed S2D items.

Today: ${today}.

${userName} is the product lead at Beacon Software, a PE-backed software holdco. Their placeholders are usually 3-15 words of intent. Your job: turn them into a concrete, board-ready task using the related context Mashi found in their data.

# What to produce
- title: clear, specific, 5-12 words. Names the actual deliverable or decision. Not "follow up" — say what.
- description: 1-3 sentences. What needs to happen, who's involved, what the relevant context is. Reference specific people/dates/numbers from the context if any.
- pathway: pick from quick_reply, drafted_response, meeting_backed, heads_down, decision_gate, delegated, watching
- priority: urgent (today / explicit deadline), high (this week), medium (this sprint), low (someday)
- status: where this should land — todo (default), backlog (no near deadline), in_queue (blocked externally)
- est_minutes: realistic estimate. 5/10/15/30/60/90/120. Null if genuinely uncertain.
- rationale: 1 sentence explaining your enrichment choices using the context

# How to use the context
- If context confirms the work is part of an existing initiative, say so in the description
- If context shows a specific deadline / commitment / waiting party, factor that into priority and pathway
- If you see an [s2d] context entry that looks like a near-duplicate of this placeholder (same scope, same target), call it out in the rationale (e.g. "Looks like MASH-1115 already covers this — consider opening that instead.") so the user can dedup before creating a new item.
- If no relevant context, just enrich the placeholder cleanly — don't fabricate

# Voice
Match ${userName}'s style: direct, no preamble, no LLM tells, no em dashes. Use real names from the context.

# Output
Strict JSON, no fences, no preamble:
{
  "title": "...",
  "description": "...",
  "pathway": "...",
  "priority": "...",
  "status": "...",
  "est_minutes": 30,
  "rationale": "..."
}`;

  const user = `Placeholder: ${placeholder}
${companyId ? `Company context: ${companyId}` : ""}

Related context Mashi found:
${contextBlock}

Enrich the placeholder. Return JSON.`;

  const resp = await trackedCreate(
    {
      model: MODELS.secondary,
      system,
      messages: [{ role: "user", content: user }],
      max_tokens: 1000,
    },
    "s2d_enrich"
  );

  const text = resp.content[0]?.type === "text" ? resp.content[0].text.trim() : "{}";
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

  try {
    const parsed = JSON.parse(cleaned) as Partial<EnrichedDraft>;
    return {
      title: parsed.title ?? placeholder,
      description: parsed.description ?? "",
      pathway: (parsed.pathway as Pathway) ?? "heads_down",
      priority: (parsed.priority as Priority) ?? "medium",
      status: (parsed.status as S2DStatus) ?? "todo",
      est_minutes: typeof parsed.est_minutes === "number" ? parsed.est_minutes : null,
      company_id: companyId,
      rationale: parsed.rationale ?? "",
      context_used: contextUsed,
    };
  } catch {
    return {
      title: placeholder,
      description: "",
      pathway: "heads_down",
      priority: "medium",
      status: "todo",
      est_minutes: null,
      company_id: companyId,
      rationale: "AI response was unparseable; using placeholder as-is.",
      context_used: contextUsed,
    };
  }
}
