"use client";

import { Sidebar } from "@/components/layout/sidebar";
import { OverlayRoot } from "@/components/layout/primitives";
import { ConnectionHealthAlert } from "@/components/layout/connection-health-alert";
import { SyncStatusBar } from "@/components/layout/sync-status-bar";
import { SprintGlobalMount } from "@/components/sprint/sprint-global-mount";
import { SpotifyGlobalMount } from "@/components/sprint/spotify-global-mount";
import { SpotlightProvider } from "@/components/spotlight/spotlight-context";
import { SpotlightAgent } from "@/components/agent/spotlight-agent";
import { CursorContextProvider } from "@/lib/agent/cursor-context";
import { AgentThreadSheet } from "@/components/agent/thread-sheet";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <CursorContextProvider>
    <SpotlightProvider>
      {/* Shell stacking context:
          - relative + z-shell keeps the shell positioned so the ambient
            layer below paints behind it (not on top of translucent
            chrome surfaces).
          - bg-transparent lets the ambient album art show through
            wherever page content doesn't have its own opaque bg.
          - z values come from src/lib/layers.ts; see AGENTS.md "Layout
            doctrine". */}
      <div className="relative z-shell flex h-screen w-full flex-col overflow-hidden bg-transparent text-foreground">
        {/* Ambient album-art background MUST live INSIDE this wrapper.
            backdrop-filter (used by the sprint focus overlay z-100 and
            other translucent surfaces) only samples within its own
            stacking context. When the ambient was rendered outside the
            wrapper, sprint mode's backdrop-blur couldn't reach it and
            the page looked pure-dark regardless of art opacity. */}
        <SpotifyGlobalMount />
        {/* The Spotify player used to live here as its own row. It's
            now rendered INSIDE each page's TopBar (see top-bar.tsx) so
            it shares a single 48px row with the page title + actions,
            no extra band stacked on top. */}
        <header className="relative z-chrome flex shrink-0 flex-col">
          <ConnectionHealthAlert />
          <SyncStatusBar />
        </header>
        <div className="flex min-h-0 flex-1">
          <Sidebar />
          {/* CSS stacking gotcha: AmbientGround is fixed inset-0 with
              z-ground (=0). Per the painting-order spec, positioned
              elements with z-index:0 paint AFTER non-positioned block
              descendants — so an unpositioned <main> would render
              BEHIND the ambient album art the moment Spotify state
              arrives and the art layer mounts. The header + sidebar
              avoid this by already being position:relative.
              `relative` here (no z-index) promotes main into the same
              z:auto/0 painting bucket as AmbientGround; DOM order
              (main is later) wins and main paints on top, where it
              belongs. */}
          <main className="relative flex min-h-0 min-w-0 flex-1 flex-col">
            {children}
          </main>
        </div>
        <SprintGlobalMount />
        <SpotlightAgent />
        <AgentThreadSheet />
        {/* Single anchor for FocusOverlay portals. Sprint focus mode +
            future focus surfaces mount their content here via
            createPortal so per-page renderers and global mounts can't
            double-instantiate the same overlay. See AGENTS.md. */}
        <OverlayRoot />
      </div>
    </SpotlightProvider>
    </CursorContextProvider>
  );
}
