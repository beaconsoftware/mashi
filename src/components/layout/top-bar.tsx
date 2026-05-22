"use client";

import { ChatToggleButton } from "@/components/chat/chat-panel";
import { NotificationHub } from "@/components/layout/notification-hub";
import { ChromeBar } from "@/components/layout/primitives";
import { SyncStatusChip } from "@/components/layout/sync-status-chip";
import { SpotifyPlayer } from "@/components/sprint/spotify-player";
import { SpotlightTrigger } from "@/components/spotlight/spotlight-trigger";

interface TopBarProps {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}

export function TopBar({ title, subtitle, right }: TopBarProps) {
  return (
    <ChromeBar as="header" className="flex h-12 shrink-0 items-center gap-3 px-4">
      <div className="flex items-baseline gap-3 shrink-0">
        <h1 className="text-sm font-semibold tracking-tight">{title}</h1>
        {subtitle && (
          <span className="text-xs text-muted-foreground">{subtitle}</span>
        )}
      </div>
      {/* Spotify player sits in the middle of the top bar. flex-1 with
          max-width keeps it from gobbling the entire row on wide
          screens; relative positioning lets its queue dropdown anchor
          to it. */}
      <div className="relative mx-auto flex w-full max-w-md flex-1 justify-center">
        <SpotifyPlayer enabled />
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {right}
        <SpotlightTrigger />
        <SyncStatusChip />
        <NotificationHub />
        <ChatToggleButton />
      </div>
    </ChromeBar>
  );
}
