import { NextRequest, NextResponse } from "next/server";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  s2d_item_id: string;
  /** Optional — set when a sprint_session row already exists. */
  sprint_session_id?: string | null;
  track_id: string;
  track_uri?: string | null;
  track_name?: string | null;
  artist_id?: string | null;
  artist_name?: string | null;
  album_name?: string | null;
  album_image_url?: string | null;
  duration_ms?: number | null;
  /** ms this sample represents — typically the poll interval (e.g. 10000). */
  ms_during_active: number;
}

/**
 * POST /api/spotify/log
 *
 * Upsert a play-row for (user, sprint_session_id, s2d_item_id, track_id).
 * The unique index handles dedupe; we accumulate ms_during_active and
 * bump last_observed_at on each sample.
 *
 * Respects user_profile.spotify_logging_enabled — when false, this is
 * a no-op (returns ok:true so the client doesn't retry).
 *
 * Multi-tenancy: service-role write with explicit user_id. The s2d
 * item is verified to belong to this user before logging so a guessed
 * UUID can't pin music data to someone else's task.
 */
export async function POST(req: NextRequest) {
  const userSb = await createSupabaseServerClient();
  const {
    data: { user },
  } = await userSb.auth.getUser();
  if (!user) return new Response("unauthorized", { status: 401 });

  const body = (await req.json()) as Body;
  if (!body?.s2d_item_id || !body?.track_id) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }
  const sample = Math.max(0, Math.min(60_000, body.ms_during_active ?? 0));
  if (sample === 0) {
    return NextResponse.json({ ok: true, skipped: "zero_ms" });
  }

  const sb = createSupabaseServiceClient();

  // Honor the per-user opt-out.
  const { data: profile } = await sb
    .from("user_profile")
    .select("spotify_logging_enabled")
    .eq("user_id", user.id)
    .maybeSingle();
  if (profile && profile.spotify_logging_enabled === false) {
    return NextResponse.json({ ok: true, skipped: "opt_out" });
  }

  // Defense in depth: the s2d item must belong to this user.
  const { data: item } = await sb
    .from("s2d_items")
    .select("id")
    .eq("user_id", user.id)
    .eq("id", body.s2d_item_id)
    .maybeSingle();
  if (!item) {
    return NextResponse.json({ error: "item_not_found" }, { status: 404 });
  }

  const now = new Date().toISOString();

  // Look up existing row by the unique (user_id, sprint_session_id, s2d_item_id, track_id)
  // tuple. Postgres composite-unique with a nullable column does NOT
  // dedupe rows where that column is null, so we branch the lookup:
  // .eq() when sprint_session_id is set, .is(null) when it isn't.
  const baseLookup = sb
    .from("spotify_track_plays")
    .select("id, ms_during_active")
    .eq("user_id", user.id)
    .eq("s2d_item_id", body.s2d_item_id)
    .eq("track_id", body.track_id);
  const lookup = body.sprint_session_id
    ? await baseLookup.eq("sprint_session_id", body.sprint_session_id).maybeSingle()
    : await baseLookup.is("sprint_session_id", null).maybeSingle();

  if (lookup.data) {
    await sb
      .from("spotify_track_plays")
      .update({
        ms_during_active: (lookup.data.ms_during_active ?? 0) + sample,
        last_observed_at: now,
        // Refresh display metadata in case track edits happened.
        track_name: body.track_name ?? null,
        artist_name: body.artist_name ?? null,
        album_name: body.album_name ?? null,
        album_image_url: body.album_image_url ?? null,
      })
      .eq("id", lookup.data.id)
      .eq("user_id", user.id);
    return NextResponse.json({ ok: true, updated: true });
  }

  const { error } = await sb.from("spotify_track_plays").insert({
    user_id: user.id,
    s2d_item_id: body.s2d_item_id,
    sprint_session_id: body.sprint_session_id ?? null,
    track_id: body.track_id,
    track_uri: body.track_uri ?? null,
    track_name: body.track_name ?? null,
    artist_id: body.artist_id ?? null,
    artist_name: body.artist_name ?? null,
    album_name: body.album_name ?? null,
    album_image_url: body.album_image_url ?? null,
    duration_ms: body.duration_ms ?? null,
    ms_during_active: sample,
    first_observed_at: now,
    last_observed_at: now,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, inserted: true });
}
