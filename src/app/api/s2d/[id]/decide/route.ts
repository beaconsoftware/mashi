import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/s2d/{id}/decide
 *
 * Records a decision note on the current item. Optionally spins up a
 * follow-up s2d_item if the user toggled "track follow-up" with a
 * snooze date.
 *
 * Body:
 *   {
 *     note: string,                            // required
 *     follow_up?: {                            // optional
 *       text: string,                          // becomes the new item's title/description
 *       snooze_until: string                   // ISO date (YYYY-MM-DD)
 *     }
 *   }
 *
 * Response: { ok: true, follow_up_id?: string }
 */

interface ReqBody {
  note?: string;
  follow_up?: {
    text?: string;
    snooze_until?: string;
  };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as ReqBody;
  const note = (body.note ?? "").trim();
  if (!note) {
    return NextResponse.json({ error: "note required" }, { status: 400 });
  }

  const userSb = await createSupabaseServerClient();
  const {
    data: { user },
  } = await userSb.auth.getUser();
  if (!user) return new Response("unauthorized", { status: 401 });

  const sb = createSupabaseServiceClient();

  // Confirm the item belongs to this user, and pull a few fields we'll
  // copy onto any follow-up (company linkage, source_type continuity so
  // the follow-up isn't unattributed).
  const { data: item, error: itemErr } = await sb
    .from("s2d_items")
    .select("id, title, company_id, source_type")
    .eq("user_id", user.id)
    .eq("id", id)
    .single();
  if (itemErr || !item) {
    return NextResponse.json({ error: "item not found" }, { status: 404 });
  }

  const now = new Date().toISOString();

  // Write the decision note + bump unseen-updates so the row pulses to
  // confirm the save landed (same affordance used by activity-confirm).
  const summary = note.length > 120 ? `${note.slice(0, 117)}…` : note;
  const { error: updateErr } = await sb
    .from("s2d_items")
    .update({
      decision_note: note,
      decision_at: now,
      has_unseen_updates: true,
      last_update_summary: `Decision recorded: ${summary}`,
      last_update_at: now,
    })
    .eq("user_id", user.id)
    .eq("id", item.id);
  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  let follow_up_id: string | undefined;

  if (body.follow_up?.text && body.follow_up.snooze_until) {
    const fuText = body.follow_up.text.trim();
    const fuDate = body.follow_up.snooze_until;
    if (fuText.length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(fuDate)) {
      // Snooze until midnight local at the chosen date. The board's
      // unsnooze logic ticks on local-day comparisons, so this matches
      // the existing "Snooze 24h" semantics.
      const snoozeIso = new Date(`${fuDate}T00:00:00`).toISOString();
      const ticketSlug = item.title
        .slice(0, 40)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      const { data: newRow, error: fuErr } = await sb
        .from("s2d_items")
        .insert({
          user_id: user.id,
          title: fuText.slice(0, 200),
          description: `Follow-up from decision on "${item.title.slice(0, 80)}". ${fuText.length > 200 ? `Full: ${fuText}` : ""}`.trim(),
          status: "in_queue",
          queue_reason: `Snoozed until ${fuDate}`,
          snoozed_until: snoozeIso,
          needs_review: false,
          pathway: "heads_down",
          priority: "medium",
          company_id: item.company_id ?? null,
          // source_type=manual marks this as user-created via the
          // decide flow rather than an external sync.
          source_type: "manual",
          source_id: `decide:${item.id}:${ticketSlug || Date.now()}`,
        })
        .select("id")
        .single();
      if (fuErr) {
        // Don't fail the whole decide save just because the follow-up
        // failed — the decision is already persisted. Surface the
        // failure so the client can show a warning toast.
        return NextResponse.json({
          ok: true,
          follow_up_error: fuErr.message,
        });
      }
      follow_up_id = newRow?.id;
    }
  }

  return NextResponse.json({ ok: true, follow_up_id });
}
