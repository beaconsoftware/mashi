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

export type AgentMode = "plan" | "act";

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
  /** Key of the thread currently rendered fullscreen via FocusOverlay,
   * if any. Format is `item:<id>` or `thread:<id>` so the same store
   * works for both item-bound and orphan threads. Null means the slot
   * owns the rendering. Only one thread can be expanded at a time —
   * setting this re-renders the slot owner as a "minimized" placeholder
   * and mounts the overlay version (mount-toggle, never double-mount). */
  expandedThreadKey: string | null;
  /**
   * Quality Phase 3: per-thread plan/act mode, keyed by the same
   * `item:<id>` / `thread:<id>` shape as expandedThreadKey so the toggle
   * survives slot/overlay swaps. Authoritative state lives on
   * agent_threads.mode in the DB; this is the optimistic mirror so the
   * <ModeToggle> can flip without a round-trip and the loop hint can
   * be passed inline on the next user turn.
   */
  modeByThread: Record<string, AgentMode>;
  openFor: (itemId: string) => void;
  /** Promote an orphan thread to item-bound after the agent confirms a
   * resolve_reference candidate + attach_thread_to_item. Updates the
   * cursor immediately so the AppShell sheet swap happens before the
   * next render. */
  bindOrphanToItem: (itemId: string) => void;
  close: () => void;
  expandThread: (key: string) => void;
  minimizeThread: () => void;
  setMode: (key: string, mode: AgentMode) => void;
}

export const useAgentThread = create<AgentThreadState>((set) => ({
  open: false,
  itemId: null,
  orphanThreadId: null,
  expandedThreadKey: null,
  modeByThread: {},
  openFor: (itemId) => set({ open: true, itemId, orphanThreadId: null }),
  bindOrphanToItem: (itemId) =>
    set({ itemId, orphanThreadId: null }),
  close: () => set({ open: false, expandedThreadKey: null }),
  expandThread: (key) => set({ expandedThreadKey: key }),
  minimizeThread: () => set({ expandedThreadKey: null }),
  setMode: (key, mode) =>
    set((s) => ({ modeByThread: { ...s.modeByThread, [key]: mode } })),
}));

export function threadKey(opts: { itemId?: string; threadId?: string }): string {
  if (opts.itemId) return `item:${opts.itemId}`;
  if (opts.threadId) return `thread:${opts.threadId}`;
  return "";
}
