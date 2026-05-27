"use client";

import { create } from "zustand";

/**
 * UI state for the agent thread sheet.
 *
 * Lives outside refine-sheet-store so the persistent agent thread and
 * the legacy refine sheet can coexist during the Phase 2/3/4 rollout.
 * Phase 6 may collapse the refine sheet entirely once every surface
 * routes through the persistent thread, but the data model is
 * deliberately separate here: refine is per-sprint-per-item state on
 * `enriched_context.thread`; this store is purely UI for the
 * persistent `agent_threads` row.
 */

interface AgentThreadState {
  open: boolean;
  /** S2D item id the open thread is bound to. Orphan threads (Spotlight)
   * land in Phase 4 and will set this to null. */
  itemId: string | null;
  openFor: (itemId: string) => void;
  close: () => void;
}

export const useAgentThread = create<AgentThreadState>((set) => ({
  open: false,
  itemId: null,
  openFor: (itemId) => set({ open: true, itemId }),
  close: () => set({ open: false }),
}));
