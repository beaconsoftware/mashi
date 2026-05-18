"use client";

import { Sidebar } from "@/components/layout/sidebar";
import { ChatPanel, ChatSummonPill } from "@/components/chat/chat-panel";
import { SyncStatusBar } from "@/components/layout/sync-status-bar";
import { SprintGlobalMount } from "@/components/sprint/sprint-global-mount";
import { SpotlightProvider } from "@/components/spotlight/spotlight-context";
import { SpotlightModal } from "@/components/spotlight/spotlight-modal";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <SpotlightProvider>
      <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col">
          <SyncStatusBar />
          {children}
        </main>
        <ChatPanel />
        <SprintGlobalMount />
        <ChatSummonPill />
        <SpotlightModal />
      </div>
    </SpotlightProvider>
  );
}
