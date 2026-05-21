"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

/**
 * Mashi-side Spotify hooks. Polling cadence is controlled by `enabled`,
 * pass `enabled: phase === "active"` so we don't burn requests when no
 * sprint is running.
 */

export interface SpotifyTrack {
  id: string;
  uri: string;
  name: string;
  duration_ms: number;
  artist_id: string | null;
  artist_name: string;
  album_name: string | null;
  album_image_url: string | null;
}

export interface SpotifyState {
  connected: boolean;
  active?: boolean;
  playing?: boolean;
  progress_ms?: number | null;
  track?: SpotifyTrack | null;
  queue?: SpotifyTrack[];
  device?: { name: string; type: string; volume_percent: number } | null;
}

const STATE_KEY = ["spotify", "state"] as const;

export function useSpotifyState(opts: { enabled: boolean }) {
  return useQuery<SpotifyState>({
    queryKey: STATE_KEY,
    enabled: opts.enabled,
    queryFn: async () => {
      const res = await fetch("/api/spotify/state", { cache: "no-store" });
      if (!res.ok) throw new Error(`state ${res.status}`);
      return (await res.json()) as SpotifyState;
    },
    refetchInterval: 8_000,
    refetchOnWindowFocus: false,
    staleTime: 4_000,
  });
}

type ControlBody =
  | { action: "play" }
  | { action: "pause" }
  | { action: "next" }
  | { action: "prev" }
  | { action: "volume"; volume_percent: number }
  | { action: "seek"; position_ms: number };

interface ControlError {
  error: string;
  reason?: string | null;
  spotify_status?: number;
  message?: string;
}

export function useSpotifyControl() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: ControlBody) => {
      const res = await fetch("/api/spotify/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as ControlError | { ok: true };
      if (!res.ok) {
        const err = json as ControlError;
        const e = new Error(err.message ?? `control ${res.status}`) as Error & {
          reason?: string | null;
          status?: number;
        };
        e.reason = err.reason ?? err.error ?? null;
        e.status = res.status;
        throw e;
      }
      return json as { ok: true };
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: STATE_KEY });
    },
  });
}

interface LogBody {
  s2d_item_id: string;
  sprint_session_id?: string | null;
  track_id: string;
  track_uri?: string | null;
  track_name?: string | null;
  artist_id?: string | null;
  artist_name?: string | null;
  album_name?: string | null;
  album_image_url?: string | null;
  duration_ms?: number | null;
  ms_during_active: number;
}

export function useSpotifyLog() {
  return useMutation({
    mutationFn: async (body: LogBody) => {
      const res = await fetch("/api/spotify/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        console.warn("[spotify-log] failed", res.status);
        return { ok: false } as const;
      }
      return (await res.json()) as { ok: true };
    },
  });
}

export function useSpotifySettings() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["spotify", "settings"],
    queryFn: async () => {
      const res = await fetch("/api/spotify/settings", { cache: "no-store" });
      if (!res.ok) throw new Error(`settings ${res.status}`);
      return (await res.json()) as { logging_enabled: boolean };
    },
  });
  const mutation = useMutation({
    mutationFn: async (logging_enabled: boolean) => {
      const res = await fetch("/api/spotify/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logging_enabled }),
      });
      if (!res.ok) throw new Error(`save ${res.status}`);
      return (await res.json()) as { ok: true };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["spotify", "settings"] }),
  });
  return { query, mutation };
}
