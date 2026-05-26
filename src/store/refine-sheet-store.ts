"use client";

import { create } from "zustand";

/**
 * Refine sheet state — the global slide-up summoned by `/` or `⌥+R`
 * from any focused sprint slot. Bound to a single item at a time.
 *
 * Lives in its own slice so any component can open / close the sheet
 * without prop-drilling: e.g. SprintActiveModeMulti's keyboard handler
 * opens it for the focused slot, the canvas's "Refine" chip opens it
 * for the canvas's own item.
 */
interface RefineSheetState {
  open: boolean;
  boundItemId: string | null;
  openFor: (itemId: string) => void;
  close: () => void;
}

export const useRefineSheet = create<RefineSheetState>((set) => ({
  open: false,
  boundItemId: null,
  openFor: (itemId) => set({ open: true, boundItemId: itemId }),
  close: () => set({ open: false }),
}));
