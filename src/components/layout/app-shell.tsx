"use client";

import { Sidebar } from "@/components/layout/sidebar";
import { ChatPanel } from "@/components/chat/chat-panel";
import { ConnectionHealthAlert } from "@/components/layout/connection-health-alert";
// ChatSummonPill removed from the always-visible UI — the pulsing
// bottom-right "Summon Mashi" pill kept reading like the copilot was
// opening by default. The ChatToggleButton in the top bar is the
// remaining (less shouty) way to open chat. ChatSummonPill is still
// exported and can be re-mounted later if we want it back.
import { SyncStatusBar } from "@/components/layout/sync-status-bar";
import { SprintGlobalMount } from "@/components/sprint/sprint-global-mount";
import {
  SpotifyGlobalMount,
  SpotifyGlobalPlayer,
} from "@/components/sprint/spotify-global-mount";
import { SpotlightProvider } from "@/components/spotlight/spotlight-context";
import { SpotlightModal } from "@/components/spotlight/spotlight-modal";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <SpotlightProvider>
      {/* Ambient album-art background. Sits behind everything at z-0.
          AppShell keeps bg-background so the layer is hidden by default
          until we explicitly opt pages into translucency — without this
          the AppShell had no backdrop and pages that assumed an opaque
          parent surface rendered as blank. */}
      <SpotifyGlobalMount />
      {/* Outer column: top band (Spotify + alerts + sync) above the
          main sidebar+content row. This guarantees the top band can
          never compete with <main>'s vertical flex math, and that the
          per-page TopBar always sits directly under the global band. */}
      {/* relative + z-10 puts the shell into the positioned stacking
          order ABOVE the ambient bg layer (which is position:fixed z-0)
          so the per-page TopBar / filter rows render in front of the
          art instead of behind it.
          bg-transparent lets the ambient album art show through wherever
          page content doesn't have its own opaque surface (sidebar,
          cards, sheets all have their own bg). Body still has
          bg-background as the fallback when no Spotify track is loaded,
          so the page never goes truly transparent. */}
      <div className="relative z-10 flex h-screen w-full flex-col overflow-hidden bg-transparent text-foreground">
        <header className="relative z-30 flex shrink-0 flex-col">
          <SpotifyGlobalPlayer />
          <ConnectionHealthAlert />
          <SyncStatusBar />
        </header>
        <div className="flex min-h-0 flex-1">
          <Sidebar />
          <main className="flex min-h-0 min-w-0 flex-1 flex-col">
            {children}
          </main>
          <ChatPanel />
        </div>
        <SprintGlobalMount />
        <SpotlightModal />
      </div>
    </SpotlightProvider>
  );
}
