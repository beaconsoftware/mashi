"use client";

import { useEffect, useRef } from "react";
import { useSpotifyState, useSpotifyLog, useSpotifySettings } from "@/hooks/use-spotify";
import { useSprintStore } from "@/store/sprint-store";

/**
 * Headless component. While a sprint is active and a track is playing,
 * samples currently-playing every LOG_INTERVAL ms and writes a log row
 * tagged to whichever item is in the FIRST active slot.
 *
 * Why the first slot and not all of them:
 * - Spotify only plays one track at a time. Attributing it to all 3
 *   parallel slots would inflate every slot's "songs played" counter.
 * - The first slot is the user's primary focus item in display order;
 *   that's a reasonable approximation. A future refinement is to ask
 *   the user "which slot were you actually on" before sprint complete.
 *
 * No UI. Renders nothing. Respects user_profile.spotify_logging_enabled
 * via the log endpoint (it no-ops the write when disabled).
 */
const LOG_INTERVAL_MS = 10_000;

export function SpotifyPlayLogger({ enabled }: { enabled: boolean }) {
  const { data } = useSpotifyState({ enabled });
  const log = useSpotifyLog();
  const { query: settingsQ } = useSpotifySettings();
  const activeSlotIds = useSprintStore((s) => s.activeSlotIds);
  const paused = useSprintStore((s) => s.paused);

  const loggingEnabled = settingsQ.data?.logging_enabled !== false;

  // Track the last-sampled track id per primary slot so we only write
  // when (track, item) actually has elapsed time.
  const lastSampleRef = useRef<{ trackId: string | null; itemId: string | null; at: number }>({
    trackId: null,
    itemId: null,
    at: 0,
  });

  useEffect(() => {
    if (!enabled || !loggingEnabled) return;
    if (paused) return;

    const tick = () => {
      const track = data?.track;
      const playing = data?.playing;
      const primary = activeSlotIds[0] ?? null;
      if (!track || !playing || !primary) {
        // Reset sampling baseline so next active period doesn't double-count.
        lastSampleRef.current = { trackId: null, itemId: null, at: Date.now() };
        return;
      }
      const now = Date.now();
      const sameContext =
        lastSampleRef.current.trackId === track.id &&
        lastSampleRef.current.itemId === primary;
      const interval = sameContext
        ? Math.min(LOG_INTERVAL_MS, now - lastSampleRef.current.at)
        : LOG_INTERVAL_MS;
      lastSampleRef.current = { trackId: track.id, itemId: primary, at: now };

      log.mutate({
        s2d_item_id: primary,
        track_id: track.id,
        track_uri: track.uri,
        track_name: track.name,
        artist_id: track.artist_id,
        artist_name: track.artist_name,
        album_name: track.album_name,
        album_image_url: track.album_image_url,
        duration_ms: track.duration_ms,
        ms_during_active: interval,
      });
    };

    const id = setInterval(tick, LOG_INTERVAL_MS);
    return () => clearInterval(id);
  }, [enabled, loggingEnabled, paused, data?.track, data?.playing, activeSlotIds, log]);

  return null;
}
