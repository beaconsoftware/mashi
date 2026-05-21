import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { spotifyFetch, readSpotifyError } from "@/lib/spotify/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Action = "play" | "pause" | "next" | "prev" | "volume" | "seek" | "resume";

interface Body {
  action: Action;
  /** For action="volume": 0-100 */
  volume_percent?: number;
  /** For action="seek": position in ms */
  position_ms?: number;
  /** For action="resume": optional Spotify context_uri (playlist/album/etc) to start fresh. */
  context_uri?: string;
}

/**
 * POST /api/spotify/control
 *
 * Sends a transport command to the user's active Spotify device.
 * Returns 200 on success, 403 with `reason: "PREMIUM_REQUIRED"` when
 * the user is on a free account, 404 when there's no active device,
 * and 412 when the user hasn't connected Spotify.
 *
 * Premium-only operations (per Spotify docs):
 *   - play, pause, next, prev, seek, volume
 * Free users get 403 on all of these. We pass that through so the UI
 * can render a single "Premium required" hint when any control returns
 * that reason.
 */
export async function POST(req: NextRequest) {
  const userSb = await createSupabaseServerClient();
  const {
    data: { user },
  } = await userSb.auth.getUser();
  if (!user) return new Response("unauthorized", { status: 401 });

  const body = (await req.json()) as Body;
  if (!body?.action) {
    return NextResponse.json({ error: "missing_action" }, { status: 400 });
  }

  let res: Response;
  switch (body.action) {
    case "play":
      res = await spotifyFetch(user.id, "/me/player/play", { method: "PUT" });
      break;
    case "pause":
      res = await spotifyFetch(user.id, "/me/player/pause", { method: "PUT" });
      break;
    case "next":
      res = await spotifyFetch(user.id, "/me/player/next", { method: "POST" });
      break;
    case "prev":
      res = await spotifyFetch(user.id, "/me/player/previous", { method: "POST" });
      break;
    case "volume": {
      const v = clampVolume(body.volume_percent);
      if (v == null) {
        return NextResponse.json({ error: "missing_volume_percent" }, { status: 400 });
      }
      res = await spotifyFetch(user.id, `/me/player/volume?volume_percent=${v}`, {
        method: "PUT",
      });
      break;
    }
    case "seek": {
      const p = body.position_ms;
      if (typeof p !== "number" || p < 0) {
        return NextResponse.json({ error: "missing_position_ms" }, { status: 400 });
      }
      res = await spotifyFetch(user.id, `/me/player/seek?position_ms=${Math.floor(p)}`, {
        method: "PUT",
      });
      break;
    }
    case "resume": {
      // Resume = "wake any device + start playing the prior context".
      // Spotify only lets us start playback on a device, so we first
      // list available devices, transfer to the first one, then issue
      // a play (optionally with a specific context_uri). If the user
      // has no idle devices at all (no Spotify open anywhere), we
      // return 404 so the UI surfaces the "Open Spotify somewhere" hint.
      const devicesRes = await spotifyFetch(user.id, "/me/player/devices");
      if (devicesRes.status === 412) {
        return NextResponse.json({ error: "no_spotify_connection" }, { status: 412 });
      }
      if (!devicesRes.ok) {
        const err = await readSpotifyError(devicesRes);
        return NextResponse.json(
          { error: "spotify_error", reason: err.reason, message: err.message },
          { status: 502 }
        );
      }
      const devices = (await devicesRes.json()) as {
        devices?: Array<{ id: string; is_active: boolean; name: string }>;
      };
      const list = devices.devices ?? [];
      if (list.length === 0) {
        return NextResponse.json(
          { error: "no_device_available", message: "Open Spotify on a device first" },
          { status: 404 }
        );
      }
      // Prefer an already-active device; otherwise the first non-restricted one.
      const target = list.find((d) => d.is_active) ?? list[0];
      // Transfer playback + start playing in one call.
      const transferRes = await spotifyFetch(user.id, "/me/player", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_ids: [target.id], play: true }),
      });
      if (!transferRes.ok && transferRes.status !== 204) {
        const err = await readSpotifyError(transferRes);
        return NextResponse.json(
          { error: "spotify_error", reason: err.reason, message: err.message },
          { status: transferRes.status === 403 ? 403 : 502 }
        );
      }
      // If a specific context was supplied, start it explicitly.
      // Without this, transfer-with-play resumes whatever the device
      // last had queued (which may differ from the user's expectation
      // of "play my last playlist").
      if (body.context_uri) {
        res = await spotifyFetch(user.id, "/me/player/play", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ context_uri: body.context_uri }),
        });
      } else {
        res = transferRes;
      }
      break;
    }
    default:
      return NextResponse.json({ error: "unknown_action" }, { status: 400 });
  }

  if (res.status === 412) {
    return NextResponse.json({ error: "no_spotify_connection" }, { status: 412 });
  }
  if (res.status === 204 || res.ok) {
    return NextResponse.json({ ok: true });
  }
  const err = await readSpotifyError(res);
  return NextResponse.json(
    { error: "spotify_error", spotify_status: err.status, reason: err.reason, message: err.message },
    { status: res.status === 404 ? 404 : res.status === 403 ? 403 : 502 }
  );
}

function clampVolume(v: number | undefined): number | null {
  if (typeof v !== "number" || Number.isNaN(v)) return null;
  return Math.max(0, Math.min(100, Math.round(v)));
}
