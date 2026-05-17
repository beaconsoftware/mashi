import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";
import { MODELS } from "@/lib/anthropic/client";
import { trackedCreate } from "@/lib/anthropic/tracked";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/s2d/justify
 * Body: { ids: string[] }
 *
 * Lazy-generates `review_justification` for any items in the review
 * queue that are missing one. The Tinder-style review deck calls this
 * when it opens so every card has a "Mashi suggests X because Y" line.
 *
 * New items get their justification at create time (see triage prompt);
 * this endpoint backfills older items that pre-date the field.
 */
interface Body {
  ids: string[];
}

export async function POST(req: NextRequest) {
  const { ids } = (await req.json()) as Body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ ok: true, generated: 0 });
  }

  const userSb = await createSupabaseServerClient();
  const {
    data: { user },
  } = await userSb.auth.getUser();
  if (!user) return new Response("unauthorized", { status: 401 });

  const sb = createSupabaseServiceClient();

  // Service-role bypasses RLS, so scope by user.id explicitly. Without
  // this filter, a malicious caller could pass another user's item ids
  // and write AI-generated justifications onto their rows.
  const { data: items } = await sb
    .from("s2d_items")
    .select(
      "id, title, description, pathway, priority, status, queue_reason, source_type, source_label"
    )
    .eq("user_id", user.id)
    .in("id", ids)
    .is("review_justification", null);

  if (!items || items.length === 0) {
    return NextResponse.json({ ok: true, generated: 0 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const system = `You write 1-2 sentence justifications for why each task got its current pathway + priority. Sidd reads these on a swipe-deck card and decides in 2 seconds whether to approve.

Today: ${today}.

# Voice
Direct. No preamble. No LLM tells. No em dashes. Cite specifics from the title/description if available. If context is thin, give your honest read of why this pathway+priority fits the title's surface signal.

# Output
Strict JSON only. No fences. No prose outside.
{
  "items": [
    { "id": "<id>", "justification": "1-2 sentences." },
    ...
  ]
}`;

  const user_msg = `Items to justify (${items.length}):
${items
  .map(
    (it) =>
      `id=${it.id}
  title: ${it.title}
  pathway: ${it.pathway} | priority: ${it.priority} | status: ${it.status}
  ${it.queue_reason ? `queue: ${it.queue_reason}` : ""}
  source: ${it.source_type} (${it.source_label ?? ""})
  desc: ${(it.description ?? "").slice(0, 200)}`
  )
  .join("\n\n")}

Return JSON.`;

  try {
    const resp = await trackedCreate(
      {
        model: MODELS.secondary,
        system,
        messages: [{ role: "user", content: user_msg }],
        max_tokens: 1500,
      },
      "review_justify"
    );
    const text = resp.content[0]?.type === "text" ? resp.content[0].text.trim() : "{}";
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const parsed = JSON.parse(cleaned) as {
      items?: Array<{ id: string; justification: string }>;
    };
    const list = parsed.items ?? [];
    const validIds = new Set(items.map((i) => i.id));
    for (const entry of list) {
      if (!validIds.has(entry.id) || !entry.justification) continue;
      await sb
        .from("s2d_items")
        .update({ review_justification: entry.justification })
        .eq("user_id", user.id)
        .eq("id", entry.id);
    }
    return NextResponse.json({ ok: true, generated: list.length });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "justify failed" },
      { status: 500 }
    );
  }
}
