"use client";

import { SpotifyAmbientBg } from "./spotify-ambient-bg";

/**
 * Global Spotify ambient surface, mounted once in the AppShell.
 *
 * Renders the ambient album-art background fixed-positioned behind
 * all content. The PLAYER itself is mounted inside each page's TopBar
 * (see src/components/layout/top-bar.tsx) so the controls sit in the
 * same row as the page title + actions, no extra header band.
 *
 * The play logger (SpotifyPlayLogger) stays scoped to sprint mode since
 * its only job is to tag tracks to the active sprint slot.
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
