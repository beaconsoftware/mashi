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
 * Compact player, fixed at top-center of the viewport. z-[200] sits
 * above the sprint takeover (z-100) so transport controls remain
 * reachable while in sprint focus. The outer wrapper is pointer-events
 * none so the empty width on either side doesn't intercept clicks on
 * page content underneath, only the player bar itself receives events.
 */
export function SpotifyGlobalPlayer() {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-2 z-[200] mx-auto flex w-full max-w-3xl justify-center px-3">
      <div className="w-full">
        <SpotifyPlayer enabled />
      </div>
    </div>
  );
}
