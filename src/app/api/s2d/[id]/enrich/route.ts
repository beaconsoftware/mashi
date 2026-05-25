import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";
import { MODELS } from "@/lib/anthropic/client";
import { trackedCreate } from "@/lib/anthropic/tracked";
import { getUserContext } from "@/lib/user-context";
import { extractKeywords, ilikeOrClause, scoreByKeywords } from "@/lib/enrich/keywords";
import type { Pathway } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/s2d/{id}/enrich
 *
 * Sprint Card v2 — Section 2 "Enrich + Plan".
 *
 * Body: { refine?: string }
 *   - missing  → first run. Build seed from item.title + item.description,
 *                route by pathway, return plan + pulled_sources +
 *                initial thread.
 *   - present  → refine turn. Append the user's message to the existing
 *                thread, run a follow-up search keyed off the refine
 *                query (e.g. "find me examples from May"), let Sonnet
 *                reply with a new assistant turn and optionally surface
 *                new pulled_sources. Pinned existing sources are kept.
 *
 * Persists everything to s2d_items.enriched_context (jsonb) and stamps
 * enriched_at. Returns the full updated enriched_context.
 *
 * Pathway routing (which sources to search):
 *   quick_reply / drafted_response → gmail + slack messages + s2d items
 *   meeting_backed                 → fireflies meetings + s2d items
 *   heads_down / decision_gate     → s2d items + linear + fireflies
 *   delegated                      → gmail + slack + s2d items
 *   watching                       → s2d items + linear (light)
 */

interface ReqBody {
  refine?: string;
}

type SourceKind = "s2d" | "gmail" | "slack" | "linear" | "fireflies";

interface PulledSource {
  kind: SourceKind;
  ref: string;
  label: string;
  snippet: string;
  when: string | null;
  pinned: boolean;
}

interface ThreadTurn {
  role: "user" | "assistant";
  content: string;
  citations?: number[];
  at: string;
}

interface EnrichedContext {
  plan: string[];
  pulled_sources: PulledSource[];
  thread: ThreadTurn[];
  last_enriched_at: string;
}

type SB = ReturnType<typeof createSupabaseServiceClient>;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as ReqBody;
  const refine = (body.refine ?? "").trim();

  const userSb = await createSupabaseServerClient();
  const {
    data: { user },
  } = await userSb.auth.getUser();
  if (!user) return new Response("unauthorized", { status: 401 });

  const sb = createSupabaseServiceClient();

  // Load the item — user-scoped so a guessed id from another tenant
  // can't run this expensive agent on their behalf.
  const { data: item, error: itemErr } = await sb
    .from("s2d_items")
    .select(
      "id, ticket_number, title, description, pathway, company_id, source_type, source_thread_id, enriched_context, enriched_at"
    )
    .eq("user_id", user.id)
    .eq("id", id)
    .single();
  if (itemErr || !item) {
    return NextResponse.json({ error: "item not found" }, { status: 404 });
  }

  const existing = (item.enriched_context ?? {}) as Partial<EnrichedContext>;
  const existingThread: ThreadTurn[] = Array.isArray(existing.thread) ? existing.thread : [];
  const existingSources: PulledSource[] = Array.isArray(existing.pulled_sources)
    ? existing.pulled_sources
    : [];

  // Seed for the search: refine query when present, else item title +
  // description. We always carry the item's own seed into refine turns
  // too so "find me examples from May" still has the topical anchor.
  const itemSeed = `${item.title ?? ""} ${item.description ?? ""}`.trim();
  const querySeed = refine ? `${refine} ${itemSeed}` : itemSeed;

  if (querySeed.length < 3) {
    return NextResponse.json(
      { error: "item has no title/description to enrich from" },
      { status: 400 }
    );
  }

  // Pathway routing — pick which sources to query.
  const pathway = (item.pathway ?? "heads_down") as Pathway;
  const sources = sourcesForPathway(pathway);

  // For refine turns we want a smaller, targeted result set we can
  // append. For first runs we want the broad context dump.
  const limitPerSource = refine ? 3 : 5;

  const hits = await runSearches({
    sb,
    userId: user.id,
    companyId: item.company_id ?? null,
    keywords: extractKeywords(querySeed),
    sources,
    limit: limitPerSource,
    excludeItemId: item.id,
  });

  // Dedupe new hits against already-pinned sources by (kind, ref) so
  // we don't surface the same item twice across refine turns.
  const pinnedKeys = new Set(
    existingSources.filter((s) => s.pinned).map((s) => `${s.kind}:${s.ref}`)
  );
  const newHits = hits.filter((h) => !pinnedKeys.has(`${h.kind}:${h.ref}`));

  // For first runs: pulled_sources = new hits. For refine turns:
  // pinned existing + new hits (unpinned existing are dropped; the
  // refine is meant to focus the source set, not accumulate).
  const nextSources: PulledSource[] = refine
    ? [...existingSources.filter((s) => s.pinned), ...newHits]
    : newHits;

  const userCtx = await getUserContext(user.id);

  // Hand to Sonnet to write the plan + assistant reply.
  const llm = await summarize({
    item: {
      title: item.title,
      description: item.description ?? null,
      pathway,
      ticket: item.ticket_number != null ? `MASH-${item.ticket_number}` : null,
    },
    refine: refine || null,
    sources: nextSources,
    priorThread: existingThread,
    userName: userCtx.firstName,
    isFirstRun: !refine,
  });

  // Build the new thread. First run: replace the thread with the
  // canonical opening pair. Refine: append the user turn + assistant
  // reply to the existing thread.
  const now = new Date().toISOString();
  const nextThread: ThreadTurn[] = refine
    ? [
        ...existingThread,
        { role: "user", content: refine, at: now },
        { role: "assistant", content: llm.assistantMessage, citations: llm.citations, at: now },
      ]
    : [
        {
          role: "user",
          content: `Enrich this item: ${item.title}`,
          at: now,
        },
        { role: "assistant", content: llm.assistantMessage, citations: llm.citations, at: now },
      ];

  // For first runs the new plan replaces the old one. For refine
  // turns we keep the prior plan unless Sonnet returned a non-empty
  // updated plan — the user's refine question might just be exploratory
  // ("show me the May examples") with no intent to rewrite the plan.
  const nextPlan: string[] = refine
    ? llm.plan.length > 0
      ? llm.plan
      : Array.isArray(existing.plan)
        ? existing.plan
        : []
    : llm.plan;

  const nextContext: EnrichedContext = {
    plan: nextPlan,
    pulled_sources: nextSources,
    thread: nextThread,
    last_enriched_at: now,
  };

  const { error: updateErr } = await sb
    .from("s2d_items")
    .update({
      enriched_context: nextContext,
      enriched_at: now,
    })
    .eq("user_id", user.id)
    .eq("id", item.id);
  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({ enriched_context: nextContext });
}

/**
 * PATCH /api/s2d/{id}/enrich
 *
 * Mutate a single source's `pinned` flag without re-running the agent.
 * Body: { source: { kind, ref }, pinned: boolean }
 *
 * Pinned sources survive refine turns; unpinned ones get replaced when
 * a follow-up search yields different hits. This is the UI's pin/unpin
 * affordance.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    source?: { kind?: string; ref?: string };
    pinned?: boolean;
  };
  const kind = body.source?.kind;
  const ref = body.source?.ref;
  const pinned = !!body.pinned;
  if (!kind || !ref) {
    return NextResponse.json(
      { error: "source { kind, ref } required" },
      { status: 400 }
    );
  }

  const userSb = await createSupabaseServerClient();
  const {
    data: { user },
  } = await userSb.auth.getUser();
  if (!user) return new Response("unauthorized", { status: 401 });

  const sb = createSupabaseServiceClient();
  const { data: item, error: itemErr } = await sb
    .from("s2d_items")
    .select("id, enriched_context")
    .eq("user_id", user.id)
    .eq("id", id)
    .single();
  if (itemErr || !item) {
    return NextResponse.json({ error: "item not found" }, { status: 404 });
  }

  const ctx = (item.enriched_context ?? {}) as Partial<EnrichedContext>;
  const sources: PulledSource[] = Array.isArray(ctx.pulled_sources) ? ctx.pulled_sources : [];
  let touched = false;
  const next = sources.map((s) => {
    if (s.kind === kind && s.ref === ref && s.pinned !== pinned) {
      touched = true;
      return { ...s, pinned };
    }
    return s;
  });
  if (!touched) {
    return NextResponse.json({ enriched_context: ctx });
  }

  const updated: EnrichedContext = {
    plan: Array.isArray(ctx.plan) ? ctx.plan : [],
    pulled_sources: next,
    thread: Array.isArray(ctx.thread) ? ctx.thread : [],
    last_enriched_at: typeof ctx.last_enriched_at === "string" ? ctx.last_enriched_at : "",
  };
  const { error } = await sb
    .from("s2d_items")
    .update({ enriched_context: updated })
    .eq("user_id", user.id)
    .eq("id", item.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ enriched_context: updated });
}

/**
 * GET /api/s2d/{id}/enrich
 *
 * Cheap reader so the card can display the current enriched_context
 * without parsing the parent s2d_items row.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const userSb = await createSupabaseServerClient();
  const {
    data: { user },
  } = await userSb.auth.getUser();
  if (!user) return new Response("unauthorized", { status: 401 });

  const sb = createSupabaseServiceClient();
  const { data: item, error } = await sb
    .from("s2d_items")
    .select("id, enriched_context, enriched_at")
    .eq("user_id", user.id)
    .eq("id", id)
    .single();
  if (error || !item) {
    return NextResponse.json({ error: "item not found" }, { status: 404 });
  }
  return NextResponse.json({
    enriched_context: item.enriched_context ?? null,
    enriched_at: item.enriched_at ?? null,
  });
}

/**
 * Decide which sources to query for a given pathway. Returning a Set so
 * callers can cheaply check membership when assembling the OR clauses.
 */
function sourcesForPathway(pathway: Pathway): Set<SourceKind> {
  switch (pathway) {
    case "quick_reply":
    case "drafted_response":
      return new Set<SourceKind>(["s2d", "gmail", "slack"]);
    case "meeting_backed":
      return new Set<SourceKind>(["s2d", "fireflies"]);
    case "decision_gate":
    case "heads_down":
      return new Set<SourceKind>(["s2d", "linear", "fireflies"]);
    case "delegated":
      return new Set<SourceKind>(["s2d", "gmail", "slack"]);
    case "watching":
      return new Set<SourceKind>(["s2d", "linear"]);
    default:
      return new Set<SourceKind>(["s2d", "linear", "fireflies"]);
  }
}

interface RunSearchesOpts {
  sb: SB;
  userId: string;
  companyId: string | null;
  keywords: string[];
  sources: Set<SourceKind>;
  limit: number;
  excludeItemId: string;
}

/**
 * Fan out across the chosen sources in parallel. Each per-source query
 * tokenises against the same keywords and limits independently. Results
 * are folded into the unified PulledSource shape with `pinned: false`
 * by default — the UI lets the user pin from there.
 */
async function runSearches(opts: RunSearchesOpts): Promise<PulledSource[]> {
  const { sb, userId, companyId, keywords, sources, limit, excludeItemId } = opts;
  if (keywords.length === 0) return [];

  const tasks: Promise<PulledSource[]>[] = [];
  if (sources.has("s2d")) tasks.push(searchS2D({ sb, userId, companyId, keywords, limit, excludeItemId }));
  if (sources.has("gmail") || sources.has("slack")) {
    tasks.push(searchMessages({ sb, userId, companyId, keywords, limit, want: sources }));
  }
  if (sources.has("linear")) tasks.push(searchLinear({ sb, userId, companyId, keywords, limit }));
  if (sources.has("fireflies")) tasks.push(searchFireflies({ sb, userId, companyId, keywords, limit }));

  const settled = await Promise.all(tasks);
  return settled.flat();
}

async function searchS2D(opts: {
  sb: SB;
  userId: string;
  companyId: string | null;
  keywords: string[];
  limit: number;
  excludeItemId: string;
}): Promise<PulledSource[]> {
  const or = ilikeOrClause(["title", "description"], opts.keywords);
  if (!or) return [];
  let q = opts.sb
    .from("s2d_items")
    .select("id, ticket_number, title, description, status, updated_at, done_at")
    .eq("user_id", opts.userId)
    .neq("id", opts.excludeItemId)
    .or(or)
    .order("updated_at", { ascending: false })
    .limit(50);
  if (opts.companyId) q = q.eq("company_id", opts.companyId);
  const { data: rows } = await q;
  return (rows ?? [])
    .map((r) => ({
      row: r,
      score: scoreByKeywords(`${r.title ?? ""} ${r.description ?? ""}`, opts.keywords),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (b.row.updated_at ?? "").localeCompare(a.row.updated_at ?? "");
    })
    .slice(0, opts.limit)
    .map(({ row: r }) => ({
      kind: "s2d" as const,
      ref: r.id,
      label: `${r.ticket_number != null ? `MASH-${r.ticket_number} · ` : ""}${r.title} (${r.status ?? "?"})`.slice(0, 140),
      snippet: (r.description ?? "").slice(0, 400),
      when: r.done_at ?? r.updated_at ?? null,
      pinned: false,
    }));
}

async function searchMessages(opts: {
  sb: SB;
  userId: string;
  companyId: string | null;
  keywords: string[];
  limit: number;
  want: Set<SourceKind>;
}): Promise<PulledSource[]> {
  const or = ilikeOrClause(["subject", "full_content", "preview"], opts.keywords);
  if (!or) return [];
  let q = opts.sb
    .from("messages")
    .select("id, source, subject, sender_name, full_content, preview, received_at")
    .eq("user_id", opts.userId)
    .or(or)
    .order("received_at", { ascending: false })
    .limit(opts.limit * 2);
  if (opts.companyId) q = q.eq("company_id", opts.companyId);
  const { data: rows } = await q;
  const out: PulledSource[] = [];
  for (const m of rows ?? []) {
    const kind: SourceKind = m.source === "slack" ? "slack" : "gmail";
    if (!opts.want.has(kind)) continue;
    out.push({
      kind,
      ref: m.id ?? "",
      label: `${m.sender_name ?? "?"}: ${m.subject ?? "(no subject)"}`.slice(0, 140),
      snippet: (m.full_content ?? m.preview ?? "").slice(0, 400),
      when: m.received_at ?? null,
      pinned: false,
    });
    if (out.length >= opts.limit) break;
  }
  return out;
}

async function searchLinear(opts: {
  sb: SB;
  userId: string;
  companyId: string | null;
  keywords: string[];
  limit: number;
}): Promise<PulledSource[]> {
  const or = ilikeOrClause(["title", "description"], opts.keywords);
  if (!or) return [];
  let q = opts.sb
    .from("linear_issues")
    .select("id, title, description, status, updated_at, url")
    .eq("user_id", opts.userId)
    .or(or)
    .order("updated_at", { ascending: false })
    .limit(opts.limit);
  if (opts.companyId) q = q.eq("company_id", opts.companyId);
  const { data: rows } = await q;
  return (rows ?? []).map((r) => ({
    kind: "linear" as const,
    ref: r.url ?? r.id ?? "",
    label: `${r.title} (${r.status ?? "?"})`.slice(0, 140),
    snippet: (r.description ?? "").slice(0, 400),
    when: r.updated_at ?? null,
    pinned: false,
  }));
}

async function searchFireflies(opts: {
  sb: SB;
  userId: string;
  companyId: string | null;
  keywords: string[];
  limit: number;
}): Promise<PulledSource[]> {
  const or = ilikeOrClause(["title", "summary"], opts.keywords);
  if (!or) return [];
  let q = opts.sb
    .from("meetings")
    .select("id, title, date, summary")
    .eq("user_id", opts.userId)
    .or(or)
    .order("date", { ascending: false })
    .limit(opts.limit);
  if (opts.companyId) q = q.eq("company_id", opts.companyId);
  const { data: rows } = await q;
  return (rows ?? []).map((m) => ({
    kind: "fireflies" as const,
    ref: m.id ?? "",
    label: (m.title ?? "(untitled meeting)").slice(0, 140),
    snippet: (m.summary ?? "").slice(0, 400),
    when: m.date ?? null,
    pinned: false,
  }));
}

interface SummarizeOpts {
  item: {
    title: string;
    description: string | null;
    pathway: Pathway;
    ticket: string | null;
  };
  refine: string | null;
  sources: PulledSource[];
  priorThread: ThreadTurn[];
  userName: string;
  isFirstRun: boolean;
}

interface SummarizeResult {
  plan: string[];
  assistantMessage: string;
  citations: number[];
}

/**
 * Single Sonnet call that produces the plan (first run only) plus an
 * assistant reply for the thread (both first run and refine). For
 * refine turns we ask Sonnet to optionally return an updated plan if
 * the refine question reframes the work.
 */
async function summarize(opts: SummarizeOpts): Promise<SummarizeResult> {
  const today = new Date().toISOString().slice(0, 10);

  const sourcesBlock =
    opts.sources.length === 0
      ? "(no sources surfaced for this query)"
      : opts.sources
          .map(
            (s, i) =>
              `[${i + 1}] (${s.kind}${s.when ? ` · ${s.when.slice(0, 10)}` : ""}) ${s.label}\n    ${s.snippet}`
          )
          .join("\n\n");

  const priorBlock =
    opts.priorThread.length === 0
      ? ""
      : opts.priorThread
          .slice(-6)
          .map((t) => `${t.role.toUpperCase()}: ${t.content}`)
          .join("\n");

  const system = `You are ${opts.userName}'s task-prep agent. They opened a sprint card and want to either understand the work better or take action on it.

Today: ${today}.

# Inputs
- The item itself (title + description + pathway).
- A set of related sources Mashi pulled from their data — numbered [1], [2], ...
- (Sometimes) a prior thread of the same conversation, and a new refine question.

# Output: strict JSON, no fences, no preamble.

If isFirstRun:
{
  "plan": ["step 1", "step 2", "step 3"],          // 2-4 concrete steps, action-first
  "assistantMessage": "1-3 sentences summarising what Mashi found and pointing at the most useful sources by number. Plain prose, no bullets.",
  "citations": [1, 2, 3]                            // source indices the assistantMessage references
}

If refine (i.e. user asked a follow-up):
{
  "plan": [],                                       // empty unless the refine reframes the plan
  "assistantMessage": "Direct answer to the refine question, grounded in the new sources. 1-3 sentences. Reference source indices.",
  "citations": [1, 2]
}

# Voice
${opts.userName}'s style: direct, no preamble, no LLM tells, no em dashes. Reference real people / dates / numbers from the sources.

# Pathway = ${opts.item.pathway}
- quick_reply / drafted_response  → plan should focus on response shape + recipients + time-to-send
- heads_down / decision_gate      → plan should focus on understanding + concrete sub-steps
- meeting_backed                  → plan should reference the underlying meeting + downstream actions
- delegated                       → plan should focus on the delegate + the followup window
- watching                        → plan can be light (one step is fine — "monitor X, escalate if Y")`;

  const userMessage = [
    `ITEM${opts.item.ticket ? ` (${opts.item.ticket})` : ""}: ${opts.item.title}`,
    opts.item.description ? `Description: ${opts.item.description}` : "",
    "",
    `PATHWAY: ${opts.item.pathway}`,
    "",
    "SOURCES:",
    sourcesBlock,
    "",
    priorBlock ? `PRIOR THREAD:\n${priorBlock}\n` : "",
    opts.refine ? `REFINE QUESTION: ${opts.refine}` : "FIRST RUN",
    "",
    `isFirstRun: ${opts.isFirstRun}`,
    "",
    "Return JSON.",
  ]
    .filter(Boolean)
    .join("\n");

  const resp = await trackedCreate(
    {
      model: MODELS.secondary,
      system,
      messages: [{ role: "user", content: userMessage }],
      max_tokens: 1200,
    },
    "s2d_item_enrich"
  );

  const text = resp.content[0]?.type === "text" ? resp.content[0].text.trim() : "{}";
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

  try {
    const parsed = JSON.parse(cleaned) as {
      plan?: string[];
      assistantMessage?: string;
      citations?: number[];
    };
    return {
      plan: Array.isArray(parsed.plan) ? parsed.plan.filter((s) => typeof s === "string") : [],
      assistantMessage: typeof parsed.assistantMessage === "string" ? parsed.assistantMessage : "",
      citations: Array.isArray(parsed.citations)
        ? parsed.citations.filter((n): n is number => typeof n === "number")
        : [],
    };
  } catch {
    return {
      plan: [],
      assistantMessage:
        "Enrichment ran but the response wasn't structured. The sources below are still pulled fresh.",
      citations: [],
    };
  }
}
