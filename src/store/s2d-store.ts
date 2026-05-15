"use client";

import { create } from "zustand";

/**
 * Zustand store for transient S2D UI state only.
 * Items themselves live in TanStack Query (`useS2DItems`) backed by Supabase.
 */
interface S2DUIState {
  selectedItemId: string | null;
  setSelectedItem: (id: string | null) => void;
}

export const useS2DStore = create<S2DUIState>((set) => ({
  selectedItemId: null,
  setSelectedItem: (id) => set({ selectedItemId: id }),
}));
