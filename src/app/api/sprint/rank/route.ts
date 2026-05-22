import { NextRequest, NextResponse } from "next/server";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";
import { MODELS } from "@/lib/anthropic/client";
import { trackedCreate } from "@/lib/anthropic/tracked";
import { getUserContext } from "@/lib/user-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/sprint/rank
 * Body: { s2dItemIds: string[] }
 *
 * Sonnet looks at the selected items and proposes a rational ordering for
 * the sprint. Returns { orderedIds }. Per the user's preference this is
 * on-demand only — not auto-fired on planner entry.
 */
export async function POST(req: NextRequest) {
  // Require auth — previously this route was open, meaning anyone with a
  // guessed UUID could read s2d_items rows via service-role.
  const userSb = await createSupabaseServerClient();
  const {
    data: { user },
  } = await userSb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { s2dItemIds } = (await req.json()) as { s2dItemIds?: string[] };
  if (!Array.isArray(s2dItemIds) || s2dItemIds.length < 2) {
    return NextResponse.json({ orderedIds: s2dItemIds ?? [] });
  }

  // Service-role bypasses RLS, so scope by user.id explicitly. Any id in
  // the request that doesn't belong to the caller is silently dropped.
  const supabase = createSupabaseServiceClient();
  const { data: items } = await supabase
    .from("s2d_items")
    .select(
      "id, ticket_number, title, description, pathway, priority, est_minutes, queue_reason, source_label"
    )
    .eq("user_id", user.id)
    .in("id", s2dItemIds);
  if (!items || items.length === 0) {
    return NextResponse.json({ orderedIds: s2dItemIds });
  }

  const today = new Date().toISOString().slice(0, 10);
  const userCtx = await getUserContext(user.id);
  const userName = userCtx.firstName;
  const system = `You order ${userName}'s sprint. They've already picked the items; you're just deciding the sequence.

Today: ${today}.

Order by:
1. True urgency first (explicit deadlines, blockers, exec/customer-waiting tasks)
2. Then by cognitive flow — heads_down work in one block, quick_replies clustered together, decision_gates after the context that informs them
3. Then by energy — high-energy/creative work earlier in the day, admin/replies later
4. Quick wins (quick_reply, drafted_response under 10m) can go first to clear the deck if they unblock others

Output strict JSON, no fences, no preamble:
{ "orderedIds": ["<id1>", "<id2>", ...] }

The output must contain EXACTLY the same ids as the input, just reordered. Don't add, drop, or invent.`;

  const userMsg = `Items to sequence:
${items
  .map(
    (i) =>
      `- id=${i.id}
    MASH-${i.ticket_number} · ${i.pathway} · ${i.priority} · ${i.est_minutes ?? "?"}m
    title: ${i.title}
    ${i.queue_reason ? `queue_reason: ${i.queue_reason}` : ""}
    ${i.description ? `desc: ${i.description.slice(0, 200)}` : ""}`
  )
  .join("\n\n")}

Return JSON.`;

  try {
    const resp = await trackedCreate(
      {
        model: MODELS.secondary,
        system,
        messages: [{ role: "user", content: userMsg }],
        max_tokens: 800,
      },
      "sprint_rank"
    );
    const text = resp.content[0]?.type === "text" ? resp.content[0].text.trim() : "{}";
    const cleaned = text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    const parsed = JSON.parse(cleaned) as { orderedIds?: string[] };
    if (!Array.isArray(parsed.orderedIds)) {
      return NextResponse.json({ orderedIds: s2dItemIds });
    }
    // Validate: same set of ids
    const inSet = new Set(s2dItemIds);
    const outSet = new Set(parsed.orderedIds.filter((id) => inSet.has(id)));
    if (outSet.size !== inSet.size) {
      // Append any missing in original order
      const missing = s2dItemIds.filter((id) => !outSet.has(id));
      return NextResponse.json({
        orderedIds: [...parsed.orderedIds.filter((id) => inSet.has(id)), ...missing],
      });
    }
    return NextResponse.json({ orderedIds: parsed.orderedIds });
  } catch (err) {
    console.warn("[sprint/rank] failed:", err);
    return NextResponse.json({ orderedIds: s2dItemIds });
  }
}
