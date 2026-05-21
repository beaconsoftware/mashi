"use client";

import { SpotifyAmbientBg } from "./spotify-ambient-bg";
import { SpotifyPlayer } from "./spotify-player";

/**
 * Global Spotify surface, mounted once in the AppShell.
 *
 * Renders TWO layers that should be present on every page:
 *   1. Ambient album-art background, fixed-positioned behind all content
 *   2. Compact player strip at the top of <main>
 *
 * The play logger (SpotifyPlayLogger) stays scoped to sprint mode since
 * its only job is to tag tracks to the active sprint slot — outside a
 * sprint there's nothing to attribute plays to.
 *
 * The ambient bg short-circuits to null when no track has ever loaded,
 * so a user without a connected Spotify account sees no visual change.
 */
export function SpotifyGlobalMount() {
  return (
    <>
      <SpotifyAmbientBg enabled />
    </>
  );
}

/**
 * Compact player meant to sit inline at the top of <main> on every
 * page. NOT fixed-positioned: the player flows in the layout so page
 * TopBars and column headers don't end up underneath it. Centered with
 * max-w-3xl so on wide screens it doesn't stretch absurdly across the
 * width of the dashboard.
 *
 * Trade-off: in sprint focus mode (z-[100] overlay), this inline
 * player is covered by the overlay. If sprint needs music controls,
 * the sprint UI should mount its own player surface again.
 */
export function SpotifyGlobalPlayer() {
  return (
    <div className="mx-auto w-full max-w-3xl px-3 pt-1.5">
      <SpotifyPlayer enabled />
    </div>
  );
}
