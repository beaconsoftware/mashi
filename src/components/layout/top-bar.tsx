"use client";

import { ChatToggleButton } from "@/components/chat/chat-panel";
import { NotificationHub } from "@/components/layout/notification-hub";
import { SyncStatusChip } from "@/components/layout/sync-status-chip";

interface TopBarProps {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}

export function TopBar({ title, subtitle, right }: TopBarProps) {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-border/40 px-4">
      <div className="flex items-baseline gap-3">
        <h1 className="text-sm font-semibold tracking-tight">{title}</h1>
        {subtitle && (
          <span className="text-xs text-muted-foreground">{subtitle}</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {right}
        <SyncStatusChip />
        <NotificationHub />
        <ChatToggleButton />
      </div>
    </header>
  );
}
