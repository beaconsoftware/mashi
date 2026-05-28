"use client";

import { create } from "zustand";

interface AppState {
  sidebarExpanded: boolean;
  setSidebarExpanded: (expanded: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  sidebarExpanded: false,
  setSidebarExpanded: (expanded) => set({ sidebarExpanded: expanded }),
}));
