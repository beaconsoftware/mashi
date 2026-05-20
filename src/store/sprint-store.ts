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

  // ── Multi-active slot rearrangement ────────────────────────────────
  /**
   * Replace activeSlotIds atomically. Callers MUST pass a permutation
   * of the current activeSlotIds (same set, just reordered). Used for
   * drag-to-reorder within the active row. Per-block timers are
   * unaffected — only display order changes.
   */
  reorderActiveSlots: (nextActiveSlotIds: string[]) => void;
  /**
   * Atomic swap: the slot occupied by slotId is replaced with queuedId.
   * Settles the outgoing block's live elapsed into accumulatedMs and
   * nulls its activatedAtMs (it becomes queued again with its prior
   * accumulated time preserved). The incoming block starts a fresh
   * activatedAtMs (or null if paused) and accumulatedMs reset to 0.
   */
  swapSlotWithQueued: (slotId: string, queuedId: string) => void;
  /**
   * Move an active-slot block back to the queue. Slot is emptied; no
   * auto-promotion (manual move ≠ Done/Skip — don't surprise the user).
   * Outgoing block's elapsed is settled into accumulatedMs.
   */
  moveSlotToQueue: (slotId: string) => void;
  /**
   * Pull a queued block into a specific empty slot index. activeSlotIds
   * grows to include the queuedId at that position. Block's
   * activatedAtMs starts now (or null if paused).
   */
  fillEmptySlot: (slotIdx: number, queuedId: string) => void;
  /**
   * Reorder the queued portion of blocks[]. Pass the new order of
   * queued ids (only ids of blocks that are pending AND not in active
   * slots). Done/skipped blocks and active-slot blocks keep their
   * positions in the full blocks array.
   */
  reorderQueue: (nextQueuedOrder: string[]) => void;
  /**
   * Un-finish a done or skipped block. target="active" routes through
   * the slot row when there's room (else lands on the bench);
   * target="bench" always lands on the bench. The block's accumulatedMs
   * is preserved so the user can see how long they'd spent before
   * closing.
   *
   * Out-of-band: caller is responsible for reverting the s2d_items row's
   * status column (PATCH /api/s2d/[id]) so the persistent board
   * reflects the move. Store has no DB awareness.
   */
  reopenBlock: (s2dItemId: string, target: "active" | "bench") => void;

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

      reorderActiveSlots: (nextActiveSlotIds) =>
        set((s) => {
          // Defensive: must be the same set, just permuted. Anything
          // else would either lose a slot or pull in a non-active id.
          const cur = new Set(s.activeSlotIds);
          if (
            nextActiveSlotIds.length !== s.activeSlotIds.length ||
            !nextActiveSlotIds.every((id) => cur.has(id))
          ) {
            return s;
          }
          return { ...s, activeSlotIds: nextActiveSlotIds };
        }),

      swapSlotWithQueued: (slotId, queuedId) =>
        set((s) => {
          const slotIdx = s.activeSlotIds.indexOf(slotId);
          if (slotIdx < 0) return s;
          const outIdx = s.blocks.findIndex((b) => b.s2dItemId === slotId);
          const inIdx = s.blocks.findIndex((b) => b.s2dItemId === queuedId);
          if (outIdx < 0 || inIdx < 0) return s;
          if (s.activeSlotIds.includes(queuedId)) return s;
          const inBlock = s.blocks[inIdx];
          if (inBlock.status === "done" || inBlock.status === "skipped") return s;

          const now = Date.now();
          const outBlock = s.blocks[outIdx];
          const liveDelta =
            !s.paused && outBlock.activatedAtMs != null
              ? now - outBlock.activatedAtMs
              : 0;

          const updatedBlocks = s.blocks.map((b, i) => {
            if (i === outIdx) {
              // Outgoing → back to queued state. Preserve accumulated.
              return {
                ...b,
                activatedAtMs: null,
                accumulatedMs: (b.accumulatedMs ?? 0) + liveDelta,
              };
            }
            if (i === inIdx) {
              // Incoming → fresh timer in the slot.
              return {
                ...b,
                activatedAtMs: s.paused ? null : now,
                accumulatedMs: 0,
              };
            }
            return b;
          });

          const nextActiveSlotIds = s.activeSlotIds.slice();
          nextActiveSlotIds[slotIdx] = queuedId;

          return { ...s, blocks: updatedBlocks, activeSlotIds: nextActiveSlotIds };
        }),

      moveSlotToQueue: (slotId) =>
        set((s) => {
          const slotIdx = s.activeSlotIds.indexOf(slotId);
          if (slotIdx < 0) return s;
          const outIdx = s.blocks.findIndex((b) => b.s2dItemId === slotId);
          if (outIdx < 0) return s;

          const now = Date.now();
          const outBlock = s.blocks[outIdx];
          const liveDelta =
            !s.paused && outBlock.activatedAtMs != null
              ? now - outBlock.activatedAtMs
              : 0;

          const updatedBlocks = s.blocks.map((b, i) =>
            i === outIdx
              ? {
                  ...b,
                  activatedAtMs: null,
                  accumulatedMs: (b.accumulatedMs ?? 0) + liveDelta,
                }
              : b
          );
          const nextActiveSlotIds = s.activeSlotIds.filter((id) => id !== slotId);
          return { ...s, blocks: updatedBlocks, activeSlotIds: nextActiveSlotIds };
        }),

      fillEmptySlot: (slotIdx, queuedId) =>
        set((s) => {
          if (s.activeSlotIds.includes(queuedId)) return s;
          if (s.activeSlotIds.length >= MAX_PARALLEL_SLOTS) return s;
          const inIdx = s.blocks.findIndex((b) => b.s2dItemId === queuedId);
          if (inIdx < 0) return s;
          const inBlock = s.blocks[inIdx];
          if (inBlock.status === "done" || inBlock.status === "skipped") return s;

          const now = Date.now();
          const updatedBlocks = s.blocks.map((b, i) =>
            i === inIdx
              ? {
                  ...b,
                  activatedAtMs: s.paused ? null : now,
                  accumulatedMs: 0,
                }
              : b
          );

          // Clamp insertion index within [0, activeSlotIds.length].
          const idx = Math.max(0, Math.min(slotIdx, s.activeSlotIds.length));
          const nextActiveSlotIds = s.activeSlotIds.slice();
          nextActiveSlotIds.splice(idx, 0, queuedId);

          return { ...s, blocks: updatedBlocks, activeSlotIds: nextActiveSlotIds };
        }),

      reorderQueue: (nextQueuedOrder) =>
        set((s) => {
          const queuedIds = new Set(
            s.blocks
              .filter(
                (b) =>
                  b.status !== "done" &&
                  b.status !== "skipped" &&
                  !s.activeSlotIds.includes(b.s2dItemId)
              )
              .map((b) => b.s2dItemId)
          );
          if (
            nextQueuedOrder.length !== queuedIds.size ||
            !nextQueuedOrder.every((id) => queuedIds.has(id))
          ) {
            return s;
          }
          // Rebuild blocks[]: walk the original order; whenever we hit
          // a queued slot, pop the next id from nextQueuedOrder.
          const cursor = nextQueuedOrder.slice();
          const blockById = new Map(s.blocks.map((b) => [b.s2dItemId, b]));
          const rebuilt = s.blocks.map((b) => {
            if (queuedIds.has(b.s2dItemId)) {
              const nextId = cursor.shift();
              if (!nextId) return b;
              return blockById.get(nextId) ?? b;
            }
            return b;
          });
          return { ...s, blocks: rebuilt };
        }),

      reopenBlock: (s2dItemId, target) =>
        set((s) => {
          const idx = s.blocks.findIndex((b) => b.s2dItemId === s2dItemId);
          if (idx < 0) return s;
          const block = s.blocks[idx];
          if (block.status !== "done" && block.status !== "skipped") return s;

          const now = Date.now();
          const canSlot =
            target === "active" && s.activeSlotIds.length < MAX_PARALLEL_SLOTS;

          // Clear terminal status. Preserve accumulatedMs so the user can
          // see how long they'd spent before closing — useful for "I
          // closed this too early" recoveries.
          const updatedBlocks = s.blocks.map((b, i) =>
            i === idx
              ? {
                  ...b,
                  status: undefined,
                  activatedAtMs: canSlot && !s.paused ? now : null,
                }
              : b
          );

          if (canSlot) {
            return {
              ...s,
              blocks: updatedBlocks,
              activeSlotIds: [...s.activeSlotIds, s2dItemId],
            };
          }
          // Falls onto the bench. User can drag/pull into a slot afterwards.
          return { ...s, blocks: updatedBlocks };
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
      // Persist enough to resume an active sprint after reload. activeSlotIds
      // is required — without it, a reload mid-sprint loses the user's
      // parked-on-bench distinction and the recovery effect re-promotes
      // bench items into slots unintentionally.
      partialize: (s) => ({
        phase: s.phase,
        selectedItemIds: s.selectedItemIds,
        blocks: s.blocks,
        createCalendarEvents: s.createCalendarEvents,
        calendarAccountId: s.calendarAccountId,
        blockStartedAtMs: s.blockStartedAtMs,
        blockElapsedMsAccum: s.blockElapsedMsAccum,
        activeIndex: s.activeIndex,
        activeSlotIds: s.activeSlotIds,
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
