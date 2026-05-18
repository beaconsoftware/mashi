"use client";

import { create } from "zustand";

interface AppState {
  chatOpen: boolean;
  toggleChat: () => void;
  setChatOpen: (open: boolean) => void;

  sidebarExpanded: boolean;
  setSidebarExpanded: (expanded: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  // Chat panel is closed by default — the always-slide-in behavior was
  // intrusive and the chat UX itself isn't differentiating from the
  // Claude+MCP path users have anyway. Users open it via the floating
  // ChatSummonPill when they actually want it.
  chatOpen: false,
  toggleChat: () => set((s) => ({ chatOpen: !s.chatOpen })),
  setChatOpen: (open) => set({ chatOpen: open }),

  sidebarExpanded: false,
  setSidebarExpanded: (expanded) => set({ sidebarExpanded: expanded }),
}));
