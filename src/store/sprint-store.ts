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
  /**
   * Multi-active (parallel) mode timing. When a block enters an active
   * slot, activatedAtMs is set to Date.now(). Pause nulls it and
   * accumulates the elapsed delta into accumulatedMs. Resume sets it
   * again. Live elapsed time =
   *   accumulatedMs + (activatedAtMs ? now - activatedAtMs : 0)
   * Queued blocks have both fields null/0.
   */
  activatedAtMs?: number | null;
  accumulatedMs?: number;
}

/**
 * Max items that can be in active slots simultaneously in parallel mode.
 * User asked for 3.
 */
export const MAX_PARALLEL_SLOTS = 3;

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

  // Active sprint state — LEGACY serial fields (kept while we migrate
  // off them; nothing should be reading these in the new multi-active UI).
  blockStartedAtMs: number | null;
  blockElapsedMsAccum: number;
  activeIndex: number;

  // Active sprint state — multi-active (parallel) mode:
  /**
   * s2dItemIds currently occupying an active slot, in display order.
   * Length is bounded by MAX_PARALLEL_SLOTS. Each id corresponds to a
   * block in `blocks` whose status is still 'pending'.
   */
  activeSlotIds: string[];

  /** When true, ALL active-slot timers are paused. */
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
  /** Advance to next block. LEGACY serial — not used in multi-active mode. */
  advance: (mark: "done" | "skipped") => void;
  /**
   * Complete a specific block by s2dItemId in multi-active mode.
   * Marks the block done/skipped, frees its slot, and promotes the
   * next queued block into the empty slot if any remain.
   */
  completeBlock: (s2dItemId: string, mark: "done" | "skipped") => void;
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
  | "activeSlotIds"
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
  activeSlotIds: [],
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
        const now = Date.now();
        // Activate the first MAX_PARALLEL_SLOTS pending blocks.
        const toActivate: string[] = [];
        const updatedBlocks = s.blocks.map((b) => {
          if (b.status === "done" || b.status === "skipped") return b;
          if (toActivate.length >= MAX_PARALLEL_SLOTS) return b;
          toActivate.push(b.s2dItemId);
          return {
            ...b,
            status: "pending" as const,
            activatedAtMs: now,
            accumulatedMs: 0,
          };
        });
        set({
          phase: "active",
          blocks: updatedBlocks,
          activeSlotIds: toActivate,
          // Legacy fields kept zeroed so any straggler reads don't blow up.
          activeIndex: 0,
          blockStartedAtMs: now,
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

      completeBlock: (s2dItemId, mark) =>
        set((s) => {
          const idx = s.blocks.findIndex((b) => b.s2dItemId === s2dItemId);
          if (idx < 0) return s;
          const block = s.blocks[idx];
          if (block.status === "done" || block.status === "skipped") return s;

          const now = Date.now();
          // Settle any live elapsed time on the finishing block — useful
          // for performance tracking even though the slot is going away.
          const liveDelta =
            !s.paused && block.activatedAtMs != null
              ? now - block.activatedAtMs
              : 0;

          // Pick the next queued block (first non-done, non-skipped, not
          // already in an active slot) to promote into the freed slot.
          const queuedIdx = s.blocks.findIndex(
            (b, i) =>
              i !== idx &&
              b.status !== "done" &&
              b.status !== "skipped" &&
              !s.activeSlotIds.includes(b.s2dItemId)
          );

          const updatedBlocks = s.blocks.map((b, i) => {
            if (i === idx) {
              return {
                ...b,
                status: mark,
                activatedAtMs: null,
                accumulatedMs: (b.accumulatedMs ?? 0) + liveDelta,
              };
            }
            if (i === queuedIdx) {
              return {
                ...b,
                activatedAtMs: s.paused ? null : now,
                accumulatedMs: 0,
              };
            }
            return b;
          });

          const nextActiveSlotIds = s.activeSlotIds.filter((id) => id !== s2dItemId);
          if (queuedIdx >= 0) {
            nextActiveSlotIds.push(s.blocks[queuedIdx].s2dItemId);
          }

          return {
            ...s,
            blocks: updatedBlocks,
            activeSlotIds: nextActiveSlotIds,
          };
        }),

      pause: () =>
        set((s) => {
          if (s.paused) return s;
          const now = Date.now();
          // Accumulate live elapsed into every active slot before freezing.
          const updatedBlocks = s.blocks.map((b) => {
            if (!s.activeSlotIds.includes(b.s2dItemId)) return b;
            if (b.activatedAtMs == null) return b;
            return {
              ...b,
              accumulatedMs: (b.accumulatedMs ?? 0) + (now - b.activatedAtMs),
              activatedAtMs: null,
            };
          });
          return {
            ...s,
            blocks: updatedBlocks,
            paused: true,
            // Legacy field for any straggler readers.
            blockStartedAtMs: null,
          };
        }),

      resume: () =>
        set((s) => {
          if (!s.paused) return s;
          const now = Date.now();
          const updatedBlocks = s.blocks.map((b) => {
            if (!s.activeSlotIds.includes(b.s2dItemId)) return b;
            return { ...b, activatedAtMs: now };
          });
          return {
            ...s,
            blocks: updatedBlocks,
            paused: false,
            blockStartedAtMs: now,
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

/**
 * Per-block live elapsed for multi-active mode. Combines accumulated
 * paused-time with the live delta from activatedAtMs. Works regardless
 * of how many slots are active concurrently.
 */
export function blockLiveElapsedMs(
  block: Pick<SprintBlock, "activatedAtMs" | "accumulatedMs">,
  paused: boolean
): number {
  const accum = block.accumulatedMs ?? 0;
  if (paused || block.activatedAtMs == null) return accum;
  return accum + (Date.now() - block.activatedAtMs);
}
