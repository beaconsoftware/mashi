import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET → cross-thread transcript search (D4).
 *
 * Full-text search over the user's own agent_messages (user + assistant
 * turns) via the generated `content_tsv` column + GIN index (migration
 * 042), using websearch_to_tsquery so a natural phrase works. Returns
 * distinct matching threads, newest-match first, each with a snippet from
 * the matched message. Owner-only RLS scopes the read to the current user;
 * the explicit user_id filter is belt-and-suspenders.
 *
 * Powers the "Conversations" group in the Spotlight Search tab.
 */
export async function GET(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const userId = userData.user.id;

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) {
    return NextResponse.json({ threads: [] });
  }

  // Pull a generous window of matching messages, then collapse to distinct
  // threads below. Cap the message scan so a very common term can't pull
  // an unbounded set.
  const matches = await supabase
    .from("agent_messages")
    .select("thread_id, role, content, created_at")
    .eq("user_id", userId)
    .in("role", ["user", "assistant"])
    .is("deleted_at", null)
    .not("content", "is", null)
    .textSearch("content_tsv", q, { type: "websearch" })
    .order("created_at", { ascending: false })
    .limit(80);

  if (matches.error) {
    return NextResponse.json({ error: matches.error.message }, { status: 500 });
  }

  const rows = (matches.data ?? []) as Array<{
    thread_id: string;
    role: string;
    content: string | null;
    created_at: string;
  }>;

  // First (newest) match per thread becomes the snippet. Preserve the
  // newest-first order the query already imposed.
  const MAX_THREADS = 12;
  const byThread = new Map<string, { snippet: string; matched_at: string }>();
  for (const r of rows) {
    if (byThread.has(r.thread_id)) continue;
    byThread.set(r.thread_id, {
      snippet: snippetAround(r.content ?? "", q),
      matched_at: r.created_at,
    });
    if (byThread.size >= MAX_THREADS) break;
  }
  const threadIds = [...byThread.keys()];
  if (threadIds.length === 0) {
    return NextResponse.json({ threads: [] });
  }

  const threadsRes = await supabase
    .from("agent_threads")
    .select("id, title, item_id, last_message_at, created_at")
    .eq("user_id", userId)
    .in("id", threadIds);
  if (threadsRes.error) {
    return NextResponse.json({ error: threadsRes.error.message }, { status: 500 });
  }
  const threadRows = (threadsRes.data ?? []) as Array<{
    id: string;
    title: string;
    item_id: string | null;
    last_message_at: string | null;
    created_at: string;
  }>;

  // Hydrate ticket numbers for bound threads in one extra query.
  const boundItemIds = threadRows
    .map((t) => t.item_id)
    .filter((x): x is string => !!x);
  let ticketByItem = new Map<string, number | null>();
  if (boundItemIds.length > 0) {
    const items = await supabase
      .from("s2d_items")
      .select("id, ticket_number")
      .eq("user_id", userId)
      .in("id", boundItemIds);
    ticketByItem = new Map(
      ((items.data ?? []) as Array<{ id: string; ticket_number: number | null }>).map(
        (r) => [r.id, r.ticket_number]
      )
    );
  }

  const threadById = new Map(threadRows.map((t) => [t.id, t]));
  // Emit in the matched-newest-first order (byThread insertion order).
  const threads = threadIds
    .map((id) => {
      const t = threadById.get(id);
      if (!t) return null;
      const hit = byThread.get(id)!;
      return {
        id: t.id,
        title: t.title,
        item_id: t.item_id,
        ticket_number: t.item_id ? ticketByItem.get(t.item_id) ?? null : null,
        is_orphan: t.item_id == null,
        last_message_at: t.last_message_at,
        created_at: t.created_at,
        snippet: hit.snippet,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x != null);

  return NextResponse.json({ threads });
}

/** A short snippet centered on the first query-term occurrence, so the
 * Spotlight row shows the user where the term matched. Falls back to the
 * head of the message when no term is found verbatim (websearch may match
 * a stem). */
function snippetAround(content: string, query: string): string {
  const flat = content.replace(/\s+/g, " ").trim();
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const lower = flat.toLowerCase();
  let idx = -1;
  for (const t of terms) {
    const at = lower.indexOf(t);
    if (at >= 0 && (idx < 0 || at < idx)) idx = at;
  }
  const RADIUS = 90;
  if (idx < 0) return flat.slice(0, RADIUS * 2);
  const start = Math.max(0, idx - RADIUS);
  const end = Math.min(flat.length, idx + RADIUS);
  return `${start > 0 ? "…" : ""}${flat.slice(start, end)}${
    end < flat.length ? "…" : ""
  }`;
}
