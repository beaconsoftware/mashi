"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Sprint planner state machine.
 *
 * Phases:
 *   - idle: no plan in progress
 *   - prioritize: stage 1 of the planner (picking + ordering items)
 *   - schedule: stage 2 (assigning durations + start times)
 *   - review: stage 3 (final review + lock-in)
 *   - active: full-screen focus mode, timer running on current block
 *   - minimized: same active state but takeover is dismissed, sticky widget visible
 *
 * The active/minimized states are persisted to localStorage so a reload or
 * tab switch doesn't kill an in-progress sprint. Planning state is also
 * persisted so the user doesn't lose work if they navigate away mid-plan.
 *
 * Why localStorage: this is single-device per user. A "resume sprint across
 * devices" feature would push state into a `sprint_sessions` table.
 */

export type SprintPhase =
  | "idle"
  | "prioritize"
  | "schedule"
  | "review"
  | "active"
  | "minimized";

export interface SprintBlock {
  s2dItemId: string;
  /** ISO string */
  startAt: string;
  durationMin: number;
  /** Set after lock-in if a GCal event was created. */
  calendarEventId?: string | null;
  /** "done" / "skipped" once the user advances past it during active mode. */
  status?: "pending" | "done" | "skipped";
}

interface SprintState {
  phase: SprintPhase;

  // Planning data
  /** Ordered list of S2D item ids the user picked to work on. */
  selectedItemIds: string[];
  /** Per-block time + duration assignments, indexed in selectedItemIds order. */
  blocks: SprintBlock[];

  // Lock-in options
  createCalendarEvents: boolean;
  /** Calendar account to push events into. Resolved from connected_accounts when null. */
  calendarAccountId: string | null;

  // Active sprint state
  /** Wall-clock ms when current block timer started (or last resumed). */
  blockStartedAtMs: number | null;
  /** ms accumulated on current block from prior runs (used after pause/resume). */
  blockElapsedMsAccum: number;
  /** Index into blocks[] of the current active block. */
  activeIndex: number;
  /** When true, timer is paused. */
  paused: boolean;
  /** ISO of when the whole sprint started. */
  sprintStartedAt: string | null;

  // Actions
  enterPlanner: () => void;
  setPhase: (phase: SprintPhase) => void;
  toggleSelected: (s2dItemId: string) => void;
  reorderSelected: (next: string[]) => void;
  setBlocks: (blocks: SprintBlock[]) => void;
  updateBlock: (s2dItemId: string, patch: Partial<SprintBlock>) => void;
  setCreateCalendarEvents: (v: boolean) => void;
  setCalendarAccountId: (id: string | null) => void;

  /** Move from review → active. */
  startSprint: () => void;
  /** Advance to next block. Marks current as done by default. */
  advance: (mark: "done" | "skipped") => void;
  pause: () => void;
  resume: () => void;
  minimize: () => void;
  unminimize: () => void;
  exitSprint: () => void;
  resetAll: () => void;
}

const INITIAL: Pick<
  SprintState,
  | "phase"
  | "selectedItemIds"
  | "blocks"
  | "createCalendarEvents"
  | "calendarAccountId"
  | "blockStartedAtMs"
  | "blockElapsedMsAccum"
  | "activeIndex"
  | "paused"
  | "sprintStartedAt"
> = {
  phase: "idle",
  selectedItemIds: [],
  blocks: [],
  createCalendarEvents: true,
  calendarAccountId: null,
  blockStartedAtMs: null,
  blockElapsedMsAccum: 0,
  activeIndex: 0,
  paused: false,
  sprintStartedAt: null,
};

export const useSprintStore = create<SprintState>()(
  persist(
    (set, get) => ({
      ...INITIAL,

      enterPlanner: () => {
        const s = get();
        if (s.phase === "active" || s.phase === "minimized") return;
        // Fresh plan
        set({
          ...INITIAL,
          phase: "prioritize",
        });
      },

      setPhase: (phase) => set({ phase }),

      toggleSelected: (id) =>
        set((s) => {
          if (s.selectedItemIds.includes(id)) {
            return { selectedItemIds: s.selectedItemIds.filter((x) => x !== id) };
          }
          return { selectedItemIds: [...s.selectedItemIds, id] };
        }),

      reorderSelected: (next) => set({ selectedItemIds: next }),

      setBlocks: (blocks) => set({ blocks }),

      updateBlock: (s2dItemId, patch) =>
        set((s) => ({
          blocks: s.blocks.map((b) =>
            b.s2dItemId === s2dItemId ? { ...b, ...patch } : b
          ),
        })),

      setCreateCalendarEvents: (v) => set({ createCalendarEvents: v }),
      setCalendarAccountId: (id) => set({ calendarAccountId: id }),

      startSprint: () => {
        const s = get();
        if (s.blocks.length === 0) return;
        set({
          phase: "active",
          activeIndex: 0,
          blockStartedAtMs: Date.now(),
          blockElapsedMsAccum: 0,
          paused: false,
          sprintStartedAt: new Date().toISOString(),
        });
      },

      advance: (mark) =>
        set((s) => {
          if (s.activeIndex >= s.blocks.length) return s;
          const updatedBlocks = s.blocks.map((b, i) =>
            i === s.activeIndex ? { ...b, status: mark } : b
          );
          const nextIndex = s.activeIndex + 1;
          // Finished the sprint
          if (nextIndex >= updatedBlocks.length) {
            return {
              ...s,
              blocks: updatedBlocks,
              activeIndex: nextIndex,
              blockStartedAtMs: null,
              blockElapsedMsAccum: 0,
              paused: false,
              // Keep phase as active so the "Sprint complete" screen is shown
            };
          }
          return {
            ...s,
            blocks: updatedBlocks,
            activeIndex: nextIndex,
            blockStartedAtMs: Date.now(),
            blockElapsedMsAccum: 0,
            paused: false,
          };
        }),

      pause: () =>
        set((s) => {
          if (s.paused || s.blockStartedAtMs == null) return s;
          const since = Date.now() - s.blockStartedAtMs;
          return {
            paused: true,
            blockElapsedMsAccum: s.blockElapsedMsAccum + since,
            blockStartedAtMs: null,
          };
        }),

      resume: () =>
        set((s) => {
          if (!s.paused) return s;
          return {
            paused: false,
            blockStartedAtMs: Date.now(),
          };
        }),

      minimize: () => {
        const s = get();
        if (s.phase !== "active") return;
        set({ phase: "minimized" });
      },

      unminimize: () => {
        const s = get();
        if (s.phase !== "minimized") return;
        set({ phase: "active" });
      },

      exitSprint: () => set({ ...INITIAL }),

      resetAll: () => set({ ...INITIAL }),
    }),
    {
      name: "mashi.sprint",
      // Persist enough to resume an active sprint after reload
      partialize: (s) => ({
        phase: s.phase,
        selectedItemIds: s.selectedItemIds,
        blocks: s.blocks,
        createCalendarEvents: s.createCalendarEvents,
        calendarAccountId: s.calendarAccountId,
        blockStartedAtMs: s.blockStartedAtMs,
        blockElapsedMsAccum: s.blockElapsedMsAccum,
        activeIndex: s.activeIndex,
        paused: s.paused,
        sprintStartedAt: s.sprintStartedAt,
      }),
    }
  )
);

/**
 * Compute live elapsed ms on the current block, including the running
 * portion since blockStartedAtMs. Pure function over the store state.
 */
export function liveElapsedMs(s: {
  blockStartedAtMs: number | null;
  blockElapsedMsAccum: number;
  paused: boolean;
}): number {
  if (s.paused || s.blockStartedAtMs == null) return s.blockElapsedMsAccum;
  return s.blockElapsedMsAccum + (Date.now() - s.blockStartedAtMs);
}
