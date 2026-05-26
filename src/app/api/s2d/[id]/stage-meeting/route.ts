import { NextRequest, NextResponse } from "next/server";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/s2d/:id/stage-meeting
 *
 * Closes a meeting_backed item by staging it for a specific upcoming
 * meeting. The talking points are persisted on enriched_context (so the
 * sprint-complete recap can surface them) and the chosen calendar event
 * id is stored both as the s2d_item's resolved-via target and on
 * enriched_context.staged_meeting.
 *
 * We do NOT write into the Google Calendar event description — that's a
 * separate authenticated call against the user's connected_account. The
 * canvas already copies the bullets to the clipboard when the user
 * clicks "Add to meeting agenda" so they can paste into the meeting note
 * directly. A future iteration can wire writeback through gcal-write.ts.
 */
interface ReqBody {
  calendarEventId?: string;
  talkingPoints?: string;
}

interface StoredEnrichedContext {
  staged_meeting?: { calendarEventId: string; talkingPoints: string };
  [k: string]: unknown;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Partial<ReqBody>;
  const calendarEventId = (body.calendarEventId ?? "").trim();
  const talkingPoints = (body.talkingPoints ?? "").trim();

  if (!calendarEventId) {
    return NextResponse.json(
      { error: "calendarEventId required" },
      { status: 400 }
    );
  }

  const userSb = await createSupabaseServerClient();
  const {
    data: { user },
  } = await userSb.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sb = createSupabaseServiceClient();

  const { data: item, error: itemErr } = await sb
    .from("s2d_items")
    .select("id, title, enriched_context")
    .eq("user_id", user.id)
    .eq("id", id)
    .single();
  if (itemErr || !item) {
    return NextResponse.json({ error: "item not found" }, { status: 404 });
  }

  // Resolve the calendar event title (best-effort) so the outcome line
  // reads like "Staged for Q4 Brand review (Fri 10am)" instead of the
  // raw external id. Either id or external_id may be passed; try both.
  const { data: events } = await sb
    .from("calendar_events")
    .select("id, external_id, title, start_at")
    .eq("user_id", user.id)
    .or(`id.eq.${calendarEventId},external_id.eq.${calendarEventId}`)
    .limit(1);
  const ev = (events as Array<{
    id: string;
    external_id: string | null;
    title: string | null;
    start_at: string;
  }> | null)?.[0];
  const eventLabel = ev?.title?.trim() || "the meeting";

  const now = new Date().toISOString();
  const enriched = { ...((item.enriched_context ?? {}) as StoredEnrichedContext) };
  enriched.staged_meeting = { calendarEventId, talkingPoints };

  const outcomeLine = `Staged for ${eventLabel}${
    talkingPoints ? ` — ${talkingPoints.split("\n")[0].slice(0, 80)}` : ""
  }`;

  const { error: updErr } = await sb
    .from("s2d_items")
    .update({
      enriched_context: enriched,
      status: "done",
      done_at: now,
      outcome: outcomeLine,
      resolved_via: "meeting:staged",
      has_unseen_updates: true,
      last_update_summary: outcomeLine,
      last_update_at: now,
    })
    .eq("user_id", user.id)
    .eq("id", item.id);
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    calendarEventId,
    eventTitle: ev?.title ?? null,
    eventStartAt: ev?.start_at ?? null,
  });
}
