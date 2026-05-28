"use client";

import { Sparkles } from "lucide-react";
import { NotificationHub } from "@/components/layout/notification-hub";
import { ChromeBar } from "@/components/layout/primitives";
import { SyncStatusChip } from "@/components/layout/sync-status-chip";
import { SpotifyPlayer } from "@/components/sprint/spotify-player";
import { useSpotlightModal } from "@/components/spotlight/spotlight-context";
import { SpotlightTrigger } from "@/components/spotlight/spotlight-trigger";
import { Button } from "@/components/ui/button";

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
        <AskMashiButton />
      </div>
    </ChromeBar>
  );
}

function AskMashiButton() {
  const { setOpen } = useSpotlightModal();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => setOpen(true)}
      className="gap-1.5"
      title="Ask Mashi (⌘K)"
    >
      <Sparkles className="h-3.5 w-3.5 text-primary" />
      <span>Mashi</span>
      <kbd className="rounded border border-border/40 bg-background/60 px-1 py-px font-mono text-[9px] text-muted-foreground">
        ⌘K
      </kbd>
    </Button>
  );
}
