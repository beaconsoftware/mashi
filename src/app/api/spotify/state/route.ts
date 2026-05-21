import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { spotifyFetch } from "@/lib/spotify/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/spotify/state
 *
 * Bundles playback state + queue into one response so the client polls
 * one endpoint per tick instead of two. Returns:
 *   {
 *     connected: boolean,
 *     active: boolean,       // true if there is an active device
 *     playing: boolean,
 *     track: { ... } | null, // current track
 *     queue: [{ ... }],      // next N tracks
 *     device: { name, type, volume_percent } | null,
 *     product: 'premium' | 'free' | 'open' | null,
 *   }
 *
 * When the user has no Spotify connection: { connected: false }.
 * When connected but no device is playing: { connected: true, active: false }.
 */
export async function GET() {
  const userSb = await createSupabaseServerClient();
  const {
    data: { user },
  } = await userSb.auth.getUser();
  if (!user) return new Response("unauthorized", { status: 401 });

  // Playback state and queue in parallel — the queue endpoint also
  // returns currently_playing but lacks `is_playing` + device info, so
  // we hit both. Two requests once every 10s is well under the rate
  // limit even for power users.
  const [stateRes, queueRes] = await Promise.all([
    spotifyFetch(user.id, "/me/player"),
    spotifyFetch(user.id, "/me/player/queue"),
  ]);

  if (stateRes.status === 412) {
    return NextResponse.json({ connected: false });
  }

  // 204 means "no active device" — common when Spotify hasn't been
  // touched recently. Surface as connected:true, active:false so the
  // UI can render the "open Spotify to start" hint.
  if (stateRes.status === 204) {
    return NextResponse.json({
      connected: true,
      active: false,
      playing: false,
      track: null,
      queue: [],
      device: null,
      product: null,
    });
  }

  if (!stateRes.ok) {
    return NextResponse.json(
      { connected: true, active: false, error: `state_${stateRes.status}` },
      { status: 200 }
    );
  }

  const state = (await stateRes.json()) as SpotifyPlaybackState;
  const queue = queueRes.ok
    ? ((await queueRes.json()) as SpotifyQueueResponse)
    : { currently_playing: null, queue: [] };

  return NextResponse.json({
    connected: true,
    active: state.device != null,
    playing: state.is_playing ?? false,
    progress_ms: state.progress_ms ?? null,
    track: state.item ? simplifyTrack(state.item) : null,
    queue: (queue.queue ?? []).slice(0, 12).map(simplifyTrack),
    device: state.device
      ? {
          name: state.device.name,
          type: state.device.type,
          volume_percent: state.device.volume_percent,
        }
      : null,
    product: null, // not fetched here to save a roundtrip; UI reads it from the connection row
  });
}

interface SpotifyPlaybackState {
  is_playing?: boolean;
  progress_ms?: number;
  item?: SpotifyTrack;
  device?: {
    name: string;
    type: string;
    volume_percent: number;
  } | null;
}

interface SpotifyQueueResponse {
  currently_playing: SpotifyTrack | null;
  queue: SpotifyTrack[];
}

interface SpotifyTrack {
  id: string;
  uri: string;
  name: string;
  duration_ms: number;
  artists: Array<{ id: string; name: string }>;
  album: {
    name: string;
    images: Array<{ url: string; width: number; height: number }>;
  };
}

function simplifyTrack(t: SpotifyTrack) {
  return {
    id: t.id,
    uri: t.uri,
    name: t.name,
    duration_ms: t.duration_ms,
    artist_id: t.artists[0]?.id ?? null,
    artist_name: t.artists.map((a) => a.name).join(", "),
    album_name: t.album?.name ?? null,
    album_image_url: pickArt(t.album?.images ?? []),
  };
}

function pickArt(images: Array<{ url: string; width: number; height: number }>): string | null {
  if (images.length === 0) return null;
  // Prefer a medium image (300-ish) for the player; the background
  // component re-fetches a larger one on its own if it wants.
  const sorted = [...images].sort((a, b) => Math.abs(a.width - 300) - Math.abs(b.width - 300));
  return sorted[0]?.url ?? images[0].url;
}
