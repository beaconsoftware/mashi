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
    source: "fireflies" | "gmail" | "slack" | "linear" | "live_fireflies";
    label: string;
    snippet: string;
    when?: string;
  }>;
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

async function searchLocal(
  sb: SB,
  placeholder: string,
  companyId: string | null,
  userId: string
): Promise<EnrichedDraft["context_used"]> {
  const q = placeholder.toLowerCase();
  const pattern = `%${q.replace(/[%_]/g, "")}%`;

  const out: EnrichedDraft["context_used"] = [];

  // Fireflies meetings — user-scoped
  let meetings = sb
    .from("meetings")
    .select("title, date, summary")
    .eq("user_id", userId)
    .or(`title.ilike.${pattern},summary.ilike.${pattern}`)
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

  // Linear issues — user-scoped
  let issues = sb
    .from("linear_issues")
    .select("title, description, status, updated_at")
    .eq("user_id", userId)
    .or(`title.ilike.${pattern},description.ilike.${pattern}`)
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

  // Messages (gmail + slack) — user-scoped
  let msgs = sb
    .from("messages")
    .select("source, subject, sender_name, full_content, preview, received_at")
    .eq("user_id", userId)
    .or(`subject.ilike.${pattern},full_content.ilike.${pattern},preview.ilike.${pattern}`)
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
