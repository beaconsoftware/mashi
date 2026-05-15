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
  chatOpen: true,
  toggleChat: () => set((s) => ({ chatOpen: !s.chatOpen })),
  setChatOpen: (open) => set({ chatOpen: open }),

  sidebarExpanded: false,
  setSidebarExpanded: (expanded) => set({ sidebarExpanded: expanded }),
}));
