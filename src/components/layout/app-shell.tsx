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
      <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
        <Sidebar />
        {/* pt-12 reserves a band at the top for the fixed SpotifyGlobalPlayer
            so per-page TopBars / filter rows aren't covered by the
            floating player at z-[200]. */}
        <main className="flex min-w-0 flex-1 flex-col pt-12">
          <ConnectionHealthAlert />
          <SyncStatusBar />
          {children}
        </main>
        <ChatPanel />
        <SprintGlobalMount />
        <SpotlightModal />
      </div>
      {/* Fixed top-center, z-[200] so it stays accessible even through
          the sprint overlay. */}
      <SpotifyGlobalPlayer />
    </SpotlightProvider>
  );
}
