import { NextRequest, NextResponse } from "next/server";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";
import { scanActivitySinceLast } from "@/lib/sprint/activity-scan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET  /api/s2d/:id/check-in
 *   Returns the activity-since-last-check-in signal list + the previous
 *   check-in timestamp. Powers the WatchCanvas activity strip on slot
 *   activation.
 *
 * POST /api/s2d/:id/check-in
 *   Records a new check-in row. Body shape:
 *     { continue: boolean, note?: string }
 *
 *   continue=true  → "Still watching": item stays in_queue, slot
 *                    promotes next. We capture a snapshot of the signals
 *                    visible at check-in time so the recap can replay
 *                    what the user saw.
 *   continue=false → "Stop watching": item is marked done with
 *                    resolved_via='abandoned' AND a check-in row is
 *                    inserted with continued=false so the trail is
 *                    complete.
 */

interface PostBody {
  continue?: boolean;
  note?: string;
}

interface CheckInRow {
  id: string;
  at: string;
  note: string | null;
  continued: boolean;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const userSb = await createSupabaseServerClient();
  const {
    data: { user },
  } = await userSb.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sb = createSupabaseServiceClient();

  // Previous check-in (most recent). If none, fall back to item.created_at.
  const { data: latest } = await sb
    .from("watch_check_ins")
    .select("id, at, note, continued")
    .eq("user_id", user.id)
    .eq("s2d_item_id", id)
    .order("at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: item } = await sb
    .from("s2d_items")
    .select("created_at, updated_at")
    .eq("user_id", user.id)
    .eq("id", id)
    .single();

  const sinceISO =
    (latest as CheckInRow | null)?.at ??
    item?.created_at ??
    new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const signals = await scanActivitySinceLast({
    sb,
    userId: user.id,
    itemId: id,
    sinceISO,
  });

  // Full history for the trail UI (most recent first).
  const { data: history } = await sb
    .from("watch_check_ins")
    .select("id, at, note, continued")
    .eq("user_id", user.id)
    .eq("s2d_item_id", id)
    .order("at", { ascending: false })
    .limit(50);

  return NextResponse.json({
    sinceISO,
    lastCheckInAt: (latest as CheckInRow | null)?.at ?? null,
    signals,
    history: history ?? [],
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as PostBody;
  const cont = body.continue !== false; // default to "still watching"
  const note = body.note?.trim() || null;

  const userSb = await createSupabaseServerClient();
  const {
    data: { user },
  } = await userSb.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sb = createSupabaseServiceClient();

  // Snapshot signals at check-in time so the recap can replay them.
  const { data: latest } = await sb
    .from("watch_check_ins")
    .select("at")
    .eq("user_id", user.id)
    .eq("s2d_item_id", id)
    .order("at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data: item } = await sb
    .from("s2d_items")
    .select("created_at, title")
    .eq("user_id", user.id)
    .eq("id", id)
    .single();
  if (!item) {
    return NextResponse.json({ error: "item not found" }, { status: 404 });
  }
  const sinceISO =
    (latest as { at: string } | null)?.at ??
    item.created_at ??
    new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const signals = await scanActivitySinceLast({
    sb,
    userId: user.id,
    itemId: id,
    sinceISO,
  });
  const now = new Date().toISOString();

  const { data: newRow, error: insertErr } = await sb
    .from("watch_check_ins")
    .insert({
      user_id: user.id,
      s2d_item_id: id,
      at: now,
      note,
      signals_since_last: { signals },
      continued: cont,
    })
    .select("id, at, note, continued")
    .single();
  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  // For "Stop watching", also close the item terminally. For "Still
  // watching", keep the item in_queue so it can be promoted again later;
  // we also bump last_update_at so the board reflects user attention.
  if (!cont) {
    const summary = note
      ? note.length > 120
        ? `${note.slice(0, 117)}…`
        : note
      : "Stopped watching";
    await sb
      .from("s2d_items")
      .update({
        status: "done",
        done_at: now,
        outcome: `Stopped watching: ${summary}`,
        resolved_via: "abandoned",
        last_update_at: now,
        last_update_summary: `Stopped watching${note ? ` — ${summary}` : ""}`,
      })
      .eq("user_id", user.id)
      .eq("id", id);
  } else {
    await sb
      .from("s2d_items")
      .update({
        status: "in_queue",
        queue_reason: note
          ? `Still watching — ${note.slice(0, 120)}`
          : "Still watching",
        last_update_at: now,
        last_update_summary: `Checked in${note ? ` — ${note.slice(0, 100)}` : ""}`,
      })
      .eq("user_id", user.id)
      .eq("id", id);
  }

  return NextResponse.json({ ok: true, checkIn: newRow, signals });
}
