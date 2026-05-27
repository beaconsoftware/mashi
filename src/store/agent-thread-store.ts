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
  /** S2D item id the open thread is bound to. Null for Spotlight orphan
   * threads. The thread sheet uses this to look up the item title and
   * pass the right id into the streaming routes. */
  itemId: string | null;
  /** Persistent thread id once the user binds an orphan thread to an
   * item, or once the orphan thread itself is created. Set by the
   * Spotlight surface; the item-bound thread sheet ignores it and
   * routes purely by itemId. */
  orphanThreadId: string | null;
  openFor: (itemId: string) => void;
  /** Promote an orphan thread to item-bound after the agent confirms a
   * resolve_reference candidate + attach_thread_to_item. Updates the
   * cursor immediately so the AppShell sheet swap happens before the
   * next render. */
  bindOrphanToItem: (itemId: string) => void;
  close: () => void;
}

export const useAgentThread = create<AgentThreadState>((set) => ({
  open: false,
  itemId: null,
  orphanThreadId: null,
  openFor: (itemId) => set({ open: true, itemId, orphanThreadId: null }),
  bindOrphanToItem: (itemId) =>
    set({ itemId, orphanThreadId: null }),
  close: () => set({ open: false }),
}));
