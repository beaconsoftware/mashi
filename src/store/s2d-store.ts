"use client";

import { create } from "zustand";

/**
 * Zustand store for transient S2D UI state only.
 * Items themselves live in TanStack Query (`useS2DItems`) backed by Supabase.
 *
 * Multi-select lives here (rather than in the board component) so the
 * selection survives Cards / List view switches, and so any descendant
 * card can read/toggle without prop-drilling.
 *
 * NOTE: `selectedItemIds` (multi-select for bulk actions) is unrelated to
 * sprint-store's `selectedItemIds` (planner-time selection). They model
 * different things and live in different stores.
 */
interface S2DUIState {
  selectedItemId: string | null;
  setSelectedItem: (id: string | null) => void;

  selectedItemIds: Set<string>;
  /** Last item toggled, per column (status string or "review"). Range
   * selects (shift-click) anchor to this id. */
  rangeAnchor: { column: string; id: string } | null;

  toggleSelected: (id: string, column: string) => void;
  clearSelected: () => void;
  setSelected: (ids: Iterable<string>) => void;
  selectRange: (ids: string[], column: string, targetId: string) => void;
}

export const useS2DStore = create<S2DUIState>((set, get) => ({
  selectedItemId: null,
  setSelectedItem: (id) => set({ selectedItemId: id }),

  selectedItemIds: new Set(),
  rangeAnchor: null,

  toggleSelected: (id, column) =>
    set((state) => {
      const next = new Set(state.selectedItemIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { selectedItemIds: next, rangeAnchor: { column, id } };
    }),

  clearSelected: () => set({ selectedItemIds: new Set(), rangeAnchor: null }),

  setSelected: (ids) =>
    set({ selectedItemIds: new Set(ids), rangeAnchor: null }),

  selectRange: (ids, column, targetId) => {
    const anchor = get().rangeAnchor;
    // Anchor must be in the same column, otherwise fall back to a single toggle.
    if (!anchor || anchor.column !== column) {
      get().toggleSelected(targetId, column);
      return;
    }
    const anchorIdx = ids.indexOf(anchor.id);
    const targetIdx = ids.indexOf(targetId);
    if (anchorIdx < 0 || targetIdx < 0) {
      get().toggleSelected(targetId, column);
      return;
    }
    const [from, to] =
      anchorIdx < targetIdx ? [anchorIdx, targetIdx] : [targetIdx, anchorIdx];
    set((state) => {
      const next = new Set(state.selectedItemIds);
      for (let i = from; i <= to; i++) next.add(ids[i]);
      return { selectedItemIds: next, rangeAnchor: { column, id: targetId } };
    });
  },
}));
