"use client";

/**
 * Multi-active sprint mode — up to 3 items in parallel "slots" with a
 * rolling queue dock below.
 *
 * Each slot has its own timer (per-block accumulated + live deltas
 * settled in the sprint store). Marking a slot Done/Skip promotes the
 * next queued block into the freed slot. Sprint completes when the
 * queue is empty AND every active slot has been closed.
 *
 * Why not extend the existing serial sprint-active-mode?
 *   - Serial assumes one "current" cursor + one timer. Parallel needs
 *     N independent timers + slot-aware actions.
 *   - Trying to make one component do both ended up with a lot of
 *     "if multiActive" branches; this is cleaner as its own surface.
 *   - The old sprint-active-mode.tsx is kept on disk and could come
 *     back as a "Focus mode" toggle later.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  SkipForward,
  Pause,
  Play,
  Minimize2,
  X,
  Sparkles,
  MessageSquare,
  Clock,
  AlertTriangle,
  GripVertical,
  ArrowDownToLine,
  ArrowUpFromLine,
  Undo2,
  CheckCheck,
} from "lucide-react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  useSprintStore,
  blockLiveElapsedMs,
  MAX_PARALLEL_SLOTS,
  type SprintBlock,
} from "@/store/sprint-store";
import { useS2DItems, useUpdateS2DItem } from "@/hooks/use-s2d";
import { PathwayBadge } from "@/components/shared/pathway-badge";
import { PriorityDot } from "@/components/shared/priority-dot";
import { CompanyBadge } from "@/components/shared/company-badge";
import { SprintContextPackage } from "@/components/sprint/sprint-context-package";
import { SprintItemContext } from "@/components/sprint/sprint-item-context";
import { ItemContextPanel } from "@/components/s2d/item-context-panel";
import { useDeckCardHover } from "@/lib/animation/interactions";
import { PATHWAY_META } from "@/types";
import { cn } from "@/lib/utils";
import type { S2DItem } from "@/types";

export function SprintActiveModeMulti() {
  const blocks = useSprintStore((s) => s.blocks);
  const activeSlotIds = useSprintStore((s) => s.activeSlotIds);
  const paused = useSprintStore((s) => s.paused);
  const sprintStartedAt = useSprintStore((s) => s.sprintStartedAt);
  const completeBlock = useSprintStore((s) => s.completeBlock);
  const pause = useSprintStore((s) => s.pause);
  const resume = useSprintStore((s) => s.resume);
  const minimize = useSprintStore((s) => s.minimize);
  const exitSprint = useSprintStore((s) => s.exitSprint);
  const reorderActiveSlots = useSprintStore((s) => s.reorderActiveSlots);
  const swapSlotWithQueued = useSprintStore((s) => s.swapSlotWithQueued);
  const moveSlotToQueue = useSprintStore((s) => s.moveSlotToQueue);
  const fillEmptySlot = useSprintStore((s) => s.fillEmptySlot);
  const reorderQueue = useSprintStore((s) => s.reorderQueue);
  const reopenBlockStore = useSprintStore((s) => s.reopenBlock);

  const updateItem = useUpdateS2DItem();
  const { data: items } = useS2DItems();

  // Detail panel is mounted INSIDE this overlay (the global S2DItemSheet
  // lives on /s2d only, so its store doesn't surface here). We track the
  // open item locally — sprint focus shouldn't context-switch to a side
  // route, and embedding keeps the other slots visible.
  const [detailItemId, setDetailItemId] = useState<string | null>(null);

  // DnD state — track the id being dragged so the overlay can render a
  // ghost of the source. Activation distance of 6px avoids hijacking
  // clicks on the slot's buttons.
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  // Tick once per second to drive the live timers.
  const [, force] = useState(0);
  // Inline error banner — surfaces failed Done/Skip/Snooze PATCHes so the
  // user can retry rather than silently watching the cache roll back.
  const [banner, setBanner] = useState<{ kind: "err"; msg: string } | null>(null);
  useEffect(() => {
    if (!banner) return;
    const id = setTimeout(() => setBanner(null), 8000);
    return () => clearTimeout(id);
  }, [banner]);
  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => force((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, [paused]);

  // Migration / recovery: if the user is in active phase but activeSlotIds
  // is empty (sprint started before multi-active shipped, or any state
  // corruption), auto-fill the first MAX_PARALLEL_SLOTS pending blocks
  // into slots. Without this, an in-flight sprint from the old serial UI
  // would render as "all slots empty" and the user would lose visibility
  // into what they were working on.
  useEffect(() => {
    if (activeSlotIds.length > 0) return;
    const firstPending = blocks
      .filter((b) => b.status !== "done" && b.status !== "skipped")
      .slice(0, MAX_PARALLEL_SLOTS)
      .map((b) => b.s2dItemId);
    if (firstPending.length === 0) return;
    // Inline-set via the store: each block needs activatedAtMs and
    // accumulatedMs initialized, then activeSlotIds populated.
    const now = Date.now();
    useSprintStore.setState((s) => ({
      ...s,
      activeSlotIds: firstPending,
      blocks: s.blocks.map((b) =>
        firstPending.includes(b.s2dItemId)
          ? {
              ...b,
              activatedAtMs: s.paused ? null : now,
              accumulatedMs: b.accumulatedMs ?? 0,
            }
          : b
      ),
    }));
  }, [activeSlotIds, blocks]);

  const itemMap = useMemo(
    () => new Map((items ?? []).map((i) => [i.id, i])),
    [items]
  );

  // Derive the three lists from the source of truth (blocks + activeSlotIds).
  const activeBlocks = activeSlotIds
    .map((id) => blocks.find((b) => b.s2dItemId === id))
    .filter((b): b is SprintBlock => b != null);
  const queuedBlocks = blocks.filter(
    (b) =>
      b.status !== "done" &&
      b.status !== "skipped" &&
      !activeSlotIds.includes(b.s2dItemId)
  );
  const completedBlocks = blocks.filter(
    (b) => b.status === "done" || b.status === "skipped"
  );

  // Mark s2d items in_progress when they enter an active slot (best-effort).
  const startedSetRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const id of activeSlotIds) {
      if (startedSetRef.current.has(id)) continue;
      const it = itemMap.get(id);
      if (!it) continue;
      if (it.status !== "in_progress") {
        updateItem.mutate({ id, patch: { status: "in_progress" } });
      }
      startedSetRef.current.add(id);
    }
  }, [activeSlotIds, itemMap, updateItem]);

  // Await the PATCH before promoting the next queued block into the freed
  // slot. If the save fails, surface a banner and keep the item in its
  // current slot so the user can retry — otherwise the cache rolls back
  // silently and the user thinks the work was saved.
  function ticketLabel(s2dItemId: string): string {
    const it = itemMap.get(s2dItemId);
    return it ? `MASH-${it.ticket_number}` : "item";
  }

  // ── DnD ───────────────────────────────────────────────────────────
  //
  // Draggables: `slot:<itemId>` and `queue:<itemId>`.
  // Droppables: `slot:<idx>` (0..MAX-1) and `queue:<itemId>` + `queue` (end).
  //
  // Resolution by drop target (in priority order):
  //   - slot → slot (same id): no-op
  //   - slot → slot (different idx): reorderActiveSlots (swap positions)
  //   - slot → queue or queue-position: moveSlotToQueue
  //   - queue → slot (occupied): swapSlotWithQueued
  //   - queue → slot (empty): fillEmptySlot
  //   - queue → queue-position: reorderQueue
  //
  // We don't auto-fill empty slots when a slot moves to queue — that's
  // intentional; the user can drag to refill or click Done/Skip on a
  // sibling slot to trigger the queue promotion via completeBlock.
  function onDragStart(e: DragStartEvent) {
    setDraggingId(String(e.active.id));
  }
  function onDragEnd(e: DragEndEvent) {
    const activeId = String(e.active.id);
    setDraggingId(null);
    if (!e.over) return;
    const overId = String(e.over.id);
    if (activeId === overId) return;

    // ── slot → ? ────────────────────────────────────────────────────
    if (activeId.startsWith("slot:")) {
      const fromItemId = activeId.slice(5);
      const fromIdx = activeSlotIds.indexOf(fromItemId);
      if (fromIdx < 0) return;

      if (overId.startsWith("slot:")) {
        const toIdx = parseInt(overId.slice(5), 10);
        if (Number.isNaN(toIdx) || toIdx === fromIdx) return;
        // Swap positions in activeSlotIds — clamp toIdx to the
        // current active count so dragging to an empty slot index
        // just moves to the end of the active row.
        const clamped = Math.max(0, Math.min(toIdx, activeSlotIds.length - 1));
        const next = activeSlotIds.slice();
        const [moved] = next.splice(fromIdx, 1);
        next.splice(clamped, 0, moved);
        reorderActiveSlots(next);
        return;
      }
      if (overId === "queue" || overId.startsWith("queue:")) {
        moveSlotToQueue(fromItemId);
        return;
      }
      return;
    }

    // ── queue → ? ───────────────────────────────────────────────────
    if (activeId.startsWith("queue:")) {
      const fromItemId = activeId.slice(6);

      if (overId.startsWith("slot:")) {
        const toIdx = parseInt(overId.slice(5), 10);
        if (Number.isNaN(toIdx)) return;
        const occupantId = activeSlotIds[toIdx];
        if (occupantId) {
          swapSlotWithQueued(occupantId, fromItemId);
        } else {
          fillEmptySlot(toIdx, fromItemId);
        }
        return;
      }
      if (overId.startsWith("queue:")) {
        const targetItemId = overId.slice(6);
        if (targetItemId === fromItemId) return;
        // Compute the new queued order: pull fromItemId out, insert
        // before targetItemId.
        const queuedIds = queuedBlocks.map((b) => b.s2dItemId);
        const next = queuedIds.filter((id) => id !== fromItemId);
        const insertAt = next.indexOf(targetItemId);
        if (insertAt < 0) {
          next.push(fromItemId);
        } else {
          next.splice(insertAt, 0, fromItemId);
        }
        reorderQueue(next);
        return;
      }
      // Dropped on the queue dock itself (no specific position) → end.
      if (overId === "queue") {
        const queuedIds = queuedBlocks.map((b) => b.s2dItemId);
        const next = queuedIds.filter((id) => id !== fromItemId);
        next.push(fromItemId);
        reorderQueue(next);
        return;
      }
    }
  }

  // The block being dragged (for the DragOverlay ghost).
  const draggingBlock = useMemo(() => {
    if (!draggingId) return null;
    const id = draggingId.startsWith("slot:")
      ? draggingId.slice(5)
      : draggingId.startsWith("queue:")
        ? draggingId.slice(6)
        : null;
    if (!id) return null;
    const block = blocks.find((b) => b.s2dItemId === id);
    if (!block) return null;
    const item = itemMap.get(id) ?? null;
    return { block, item };
  }, [draggingId, blocks, itemMap]);

  async function markDone(s2dItemId: string) {
    try {
      await updateItem.mutateAsync({
        id: s2dItemId,
        patch: {
          status: "done",
          outcome: "Completed in sprint",
          resolved_via: "manual",
        },
      });
      completeBlock(s2dItemId, "done");
    } catch (err) {
      setBanner({
        kind: "err",
        msg: `Couldn't save ${ticketLabel(s2dItemId)}: ${
          err instanceof Error ? err.message : "save failed"
        } — try again`,
      });
    }
  }
  async function skip(s2dItemId: string) {
    try {
      await updateItem.mutateAsync({ id: s2dItemId, patch: { status: "todo" } });
      completeBlock(s2dItemId, "skipped");
    } catch (err) {
      setBanner({
        kind: "err",
        msg: `Couldn't skip ${ticketLabel(s2dItemId)}: ${
          err instanceof Error ? err.message : "save failed"
        } — try again`,
      });
    }
  }
  async function snooze(s2dItemId: string) {
    const t = new Date();
    t.setDate(t.getDate() + 1);
    t.setHours(9, 0, 0, 0);
    try {
      await updateItem.mutateAsync({
        id: s2dItemId,
        patch: {
          status: "in_queue",
          snoozed_until: t.toISOString(),
          queue_reason: "Snoozed mid-sprint (24h)",
        },
      });
      completeBlock(s2dItemId, "skipped");
    } catch (err) {
      setBanner({
        kind: "err",
        msg: `Couldn't snooze ${ticketLabel(s2dItemId)}: ${
          err instanceof Error ? err.message : "save failed"
        } — try again`,
      });
    }
  }

  /**
   * Park an active item on the Bench. Two steps that must both succeed
   * for the move to feel coherent: PATCH s2d_items to 'todo' so the
   * persistent row reflects the move, then call moveSlotToQueue. If
   * any pending Bench items are present, we additionally fill the
   * freed slot with the head of the queue so we don't waste display
   * real estate.
   */
  async function sendToBench(s2dItemId: string) {
    try {
      await updateItem.mutateAsync({ id: s2dItemId, patch: { status: "todo" } });
      // Compute the head-of-queue BEFORE we mutate so the slot index
      // is stable when we go to fill.
      const head = queuedBlocks[0]?.s2dItemId;
      const slotIdx = activeSlotIds.indexOf(s2dItemId);
      moveSlotToQueue(s2dItemId);
      if (head && slotIdx >= 0) {
        fillEmptySlot(slotIdx, head);
      }
    } catch (err) {
      setBanner({
        kind: "err",
        msg: `Couldn't bench ${ticketLabel(s2dItemId)}: ${
          err instanceof Error ? err.message : "save failed"
        } — try again`,
      });
    }
  }

  /**
   * Pull a Bench item into an active slot. If a slot is free, fill it;
   * otherwise swap with the active slot whose live elapsed is highest
   * (user's clearly pivoting away from that one). Persistent row goes
   * to in_progress, and if a slot was displaced, that row goes back to
   * 'todo'.
   */
  async function pullFromBench(s2dItemId: string) {
    const willSwap = activeSlotIds.length >= MAX_PARALLEL_SLOTS;
    let displacedId: string | null = null;
    if (willSwap) {
      let longest = -1;
      for (const aid of activeSlotIds) {
        const ab = blocks.find((b) => b.s2dItemId === aid);
        if (!ab) continue;
        const live = blockLiveElapsedMs(ab, paused);
        if (live > longest) {
          longest = live;
          displacedId = aid;
        }
      }
    }
    try {
      await updateItem.mutateAsync({
        id: s2dItemId,
        patch: { status: "in_progress" },
      });
      if (willSwap && displacedId) {
        try {
          await updateItem.mutateAsync({
            id: displacedId,
            patch: { status: "todo" },
          });
        } catch (err) {
          setBanner({
            kind: "err",
            msg: `Pulled ${ticketLabel(s2dItemId)} but couldn't bench ${ticketLabel(displacedId)}: ${
              err instanceof Error ? err.message : "save failed"
            }`,
          });
          // Continue with the in-memory swap regardless — the displaced
          // row's persistent status will be one sync behind.
        }
        swapSlotWithQueued(displacedId, s2dItemId);
      } else {
        // Append to the active row (end). fillEmptySlot clamps the idx.
        fillEmptySlot(activeSlotIds.length, s2dItemId);
      }
    } catch (err) {
      setBanner({
        kind: "err",
        msg: `Couldn't pull ${ticketLabel(s2dItemId)}: ${
          err instanceof Error ? err.message : "save failed"
        } — try again`,
      });
    }
  }

  /**
   * Mark a Bench item Done directly without first pulling it into a
   * slot. completeBlock handles both the bench case (where the item
   * isn't in activeSlotIds) and the legacy auto-promote.
   */
  async function markBenchDone(s2dItemId: string) {
    try {
      await updateItem.mutateAsync({
        id: s2dItemId,
        patch: {
          status: "done",
          outcome: "Completed in sprint",
          resolved_via: "manual",
        },
      });
      completeBlock(s2dItemId, "done");
    } catch (err) {
      setBanner({
        kind: "err",
        msg: `Couldn't save ${ticketLabel(s2dItemId)}: ${
          err instanceof Error ? err.message : "save failed"
        } — try again`,
      });
    }
  }

  /**
   * Un-finish a done or skipped block. target='active' takes a slot if
   * one is free, otherwise lands on the bench. target='bench' always
   * parks. Persistent row is reverted to in_progress / todo and the
   * outcome + resolved_via are cleared (PATCH server-side also resets
   * done_at).
   */
  async function reopen(s2dItemId: string, target: "active" | "bench") {
    const slotsFree = activeSlotIds.length < MAX_PARALLEL_SLOTS;
    const willLandOnSlot = target === "active" && slotsFree;
    const desiredStatus = willLandOnSlot ? "in_progress" : "todo";
    try {
      await updateItem.mutateAsync({
        id: s2dItemId,
        patch: {
          status: desiredStatus,
          outcome: null,
          resolved_via: null,
        },
      });
      reopenBlockStore(s2dItemId, target);
    } catch (err) {
      setBanner({
        kind: "err",
        msg: `Couldn't reopen ${ticketLabel(s2dItemId)}: ${
          err instanceof Error ? err.message : "save failed"
        } — try again`,
      });
    }
  }

  // Keyboard: 1/2/3 = Done on slot N; q/w/e = Skip on slot N; space = pause
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName ?? "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === " ") {
        e.preventDefault();
        paused ? resume() : pause();
      } else if (e.key === "Escape") {
        e.preventDefault();
        // Detail panel takes Esc first — closing it is the obviously-
        // intended action, not "exit the whole sprint".
        if (detailItemId) {
          setDetailItemId(null);
          return;
        }
        if (confirm("Exit sprint? Progress on active items is saved.")) exitSprint();
      } else if (e.key >= "1" && e.key <= "3") {
        const idx = parseInt(e.key, 10) - 1;
        const id = activeSlotIds[idx];
        if (id) {
          e.preventDefault();
          markDone(id);
        }
      } else if (e.key === "q" || e.key === "w" || e.key === "e") {
        const idx = { q: 0, w: 1, e: 2 }[e.key]!;
        const id = activeSlotIds[idx];
        if (id) {
          e.preventDefault();
          skip(id);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSlotIds, paused, detailItemId]);

  const total = blocks.length;
  const done = completedBlocks.filter((b) => b.status === "done").length;
  const skippedCount = completedBlocks.filter((b) => b.status === "skipped").length;
  const elapsedMin = sprintStartedAt
    ? Math.round((Date.now() - new Date(sprintStartedAt).getTime()) / 60_000)
    : 0;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-background text-foreground">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-border/30 px-6 py-3">
        <div className="flex items-center gap-3">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Sprint · multi-active</span>
          <span className="rounded-md bg-secondary/50 px-2 py-0.5 text-[11px] text-muted-foreground">
            {done} done · {skippedCount} skipped · {total - done - skippedCount} left ·{" "}
            {elapsedMin}m elapsed
          </span>
          {paused && (
            <span className="rounded-md border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-300">
              paused
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            onClick={() => (paused ? resume() : pause())}
            className="gap-1.5"
          >
            {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
            {paused ? "Resume" : "Pause"}
            <span className="ml-1 font-mono text-[10px] opacity-60">space</span>
          </Button>
          <Button size="sm" variant="ghost" onClick={minimize} className="gap-1.5">
            <Minimize2 className="h-3.5 w-3.5" />
            Minimize
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              if (confirm("Exit sprint? Progress on active items is saved.")) {
                exitSprint();
              }
            }}
            className="gap-1.5 text-destructive"
          >
            <X className="h-3.5 w-3.5" />
            Exit
          </Button>
        </div>
      </div>

      {banner && (
        <div className="border-b border-destructive/40 bg-destructive/10 px-4 py-2">
          <div className="flex items-start gap-2 text-[12px] text-destructive">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="flex-1">{banner.msg}</span>
            <button
              onClick={() => setBanner(null)}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        {/* Active slots — 3 columns side by side on wide, stacked on narrow */}
        <div className="grid flex-1 min-h-0 grid-cols-1 gap-4 overflow-y-auto p-4 lg:grid-cols-3">
          {Array.from({ length: MAX_PARALLEL_SLOTS }).map((_, slotIdx) => {
            const block = activeBlocks[slotIdx];
            if (!block) {
              return (
                <EmptySlot
                  key={`empty-${slotIdx}`}
                  slotIdx={slotIdx}
                  hasMoreInQueue={queuedBlocks.length > 0}
                />
              );
            }
            const item = itemMap.get(block.s2dItemId);
            if (!item) {
              return (
                <div
                  key={block.s2dItemId}
                  className="rounded-xl border border-border/30 bg-card/60 p-4 text-[12px] text-muted-foreground"
                >
                  MASH item missing from cache (id {block.s2dItemId.slice(0, 8)})
                </div>
              );
            }
            return (
              <SlotCard
                key={block.s2dItemId}
                slotIdx={slotIdx}
                block={block}
                item={item}
                paused={paused}
                isDragging={draggingId === `slot:${block.s2dItemId}`}
                onDone={() => markDone(block.s2dItemId)}
                onSkip={() => skip(block.s2dItemId)}
                onSnooze={() => snooze(block.s2dItemId)}
                onBench={() => sendToBench(block.s2dItemId)}
                onOpen={() => setDetailItemId(block.s2dItemId)}
              />
            );
          })}
        </div>

        {/* Bench (formerly "Up next" — items selected for this sprint that
            aren't in an active slot). Always rendered so a slot can be
            dragged here to send it back. */}
        <BenchStrip
          blocks={queuedBlocks}
          itemMap={itemMap}
          draggingId={draggingId}
          activeSlotsFull={activeSlotIds.length >= MAX_PARALLEL_SLOTS}
          onPull={pullFromBench}
          onMarkDone={markBenchDone}
          onOpen={(id) => setDetailItemId(id)}
        />

        {/* Done strip */}
        {completedBlocks.length > 0 && (
          <DoneStrip
            blocks={completedBlocks}
            itemMap={itemMap}
            activeSlotsFull={activeSlotIds.length >= MAX_PARALLEL_SLOTS}
            onReopen={reopen}
            onOpen={(id) => setDetailItemId(id)}
          />
        )}

        <DragOverlay dropAnimation={null}>
          {draggingBlock && draggingBlock.item ? (
            <DragGhost block={draggingBlock.block} item={draggingBlock.item} paused={paused} />
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Inline detail panel — slides in from the right inside the sprint
          overlay so the user can still see the other slots & queue. */}
      {detailItemId && (
        <DetailPanel
          item={itemMap.get(detailItemId) ?? null}
          onClose={() => setDetailItemId(null)}
        />
      )}
    </div>
  );
}

function DetailPanel({
  item,
  onClose,
}: {
  item: S2DItem | null;
  onClose: () => void;
}) {
  return (
    <>
      {/* Backdrop — click to close. z-index above the slots but below
          any future modals. */}
      <div
        className="fixed inset-0 z-[110] bg-background/70 backdrop-blur-sm"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-label="Item detail"
        className="fixed right-0 top-0 z-[120] flex h-full w-full max-w-xl flex-col border-l border-border/40 bg-background shadow-2xl"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border/30 px-4 py-2">
          <div className="flex min-w-0 items-center gap-2">
            {item && (
              <>
                <span className="font-mono text-[10px] text-muted-foreground">
                  MASH-{item.ticket_number}
                </span>
                <PathwayBadge pathway={item.pathway} compact />
                <PriorityDot priority={item.priority} />
                <span className="line-clamp-1 text-[13px] font-semibold">
                  {item.title}
                </span>
              </>
            )}
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={onClose}
            className="gap-1.5"
            title="Close (Esc)"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {item ? (
            <ItemContextPanel item={item} />
          ) : (
            <div className="text-[12px] text-muted-foreground">
              Item not in cache.
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

function SlotCard({
  slotIdx,
  block,
  item,
  paused,
  isDragging,
  onDone,
  onSkip,
  onSnooze,
  onBench,
  onOpen,
}: {
  slotIdx: number;
  block: SprintBlock;
  item: S2DItem;
  paused: boolean;
  isDragging: boolean;
  onDone: () => void;
  onSkip: () => void;
  onSnooze: () => void;
  onBench: () => void;
  onOpen: () => void;
}) {
  const elapsedMs = blockLiveElapsedMs(block, paused);
  const totalMs = block.durationMin * 60_000;
  const remainingMs = Math.max(0, totalMs - elapsedMs);
  const overrunMs = elapsedMs > totalMs ? elapsedMs - totalMs : 0;
  const pct = Math.min(100, (elapsedMs / totalMs) * 100);

  // For dialog labels: "1/2/3" matches the keyboard shortcut user sees.
  const slotKey = `${slotIdx + 1}`;
  const skipKey = ["q", "w", "e"][slotIdx];

  // DnD: the slot is both a drop target (so queue items / other slots
  // can land on it at position slotIdx) and a draggable source (via the
  // grip handle in the header).
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `slot:${slotIdx}`,
  });
  const {
    setNodeRef: setDragRef,
    attributes,
    listeners,
  } = useDraggable({ id: `slot:${block.s2dItemId}` });
  const composedRef = (el: HTMLDivElement | null) => {
    setDropRef(el);
    setDragRef(el);
  };

  return (
    <div
      ref={composedRef}
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-xl border bg-card shadow-md transition-colors",
        overrunMs > 0
          ? "border-destructive/60"
          : paused
            ? "border-border/40"
            : "border-primary/40",
        isOver && "ring-2 ring-primary/60",
        isDragging && "opacity-50"
      )}
    >
      {/* Slot header strip — also the drag handle so card body remains
          clickable for Done/Skip/Detail buttons. */}
      <div className="flex items-center gap-2 border-b border-border/30 bg-secondary/30 px-3 py-1.5">
        <button
          type="button"
          {...listeners}
          {...attributes}
          className="cursor-grab touch-none rounded p-0.5 text-muted-foreground hover:bg-secondary active:cursor-grabbing"
          title="Drag to reorder or swap with queue"
          aria-label="Drag slot"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
        <span className="rounded bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-primary">
          {slotKey}
        </span>
        <span className="font-mono text-[10px] text-muted-foreground">
          MASH-{item.ticket_number}
        </span>
        <PathwayBadge pathway={item.pathway} compact />
        <PriorityDot priority={item.priority} />
        {item.company && (
          <div className="ml-auto">
            <CompanyBadge company={item.company} />
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col overflow-y-auto p-3">
        <h3 className="text-balance text-base font-semibold leading-snug">
          {item.title}
        </h3>

        {/* Timer */}
        <div className="mt-3 flex items-baseline gap-2">
          <span
            className={cn(
              "font-mono text-3xl font-bold tabular-nums tracking-tight",
              overrunMs > 0
                ? "text-destructive"
                : paused
                  ? "text-muted-foreground"
                  : "text-foreground"
            )}
          >
            {overrunMs > 0 ? `+${fmtMs(overrunMs)}` : fmtMs(remainingMs)}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {overrunMs > 0
              ? "over plan"
              : `of ${block.durationMin}m`}
          </span>
        </div>
        {/* Progress sliver */}
        <div className="mt-1 h-0.5 w-full overflow-hidden rounded-full bg-border/30">
          <div
            className={cn(
              "h-full transition-all",
              overrunMs > 0 ? "bg-destructive" : "bg-primary"
            )}
            style={{ width: `${pct}%` }}
          />
        </div>

        {/* Context package — pathway-specific call-to-action (draft a
            reply, copy Claude prompt, etc.) followed by source-aware
            context so the user can stay heads-down in the slot. */}
        <div className="mt-3 flex-1 space-y-2">
          <SprintContextPackage item={item} />
          <SprintItemContext item={item} enabled />
        </div>

        {/* Footer actions */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <Button size="sm" onClick={onDone} className="gap-1.5">
            <Check className="h-3.5 w-3.5" />
            Done <span className="ml-1 font-mono text-[10px] opacity-60">{slotKey}</span>
          </Button>
          <Button size="sm" variant="outline" onClick={onSkip} className="gap-1.5">
            <SkipForward className="h-3.5 w-3.5" />
            Skip <span className="ml-1 font-mono text-[10px] opacity-60">{skipKey}</span>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onBench}
            className="gap-1.5 text-muted-foreground"
            title="Park on the Bench and pull the next item in"
          >
            <ArrowDownToLine className="h-3.5 w-3.5" />
            Bench
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onSnooze}
            className="gap-1.5 text-muted-foreground"
          >
            <Clock className="h-3.5 w-3.5" />
            Snooze 24h
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onOpen}
            className="ml-auto gap-1.5 text-muted-foreground"
            title="Open in side panel for full context"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Detail
          </Button>
        </div>
      </div>
    </div>
  );
}

function EmptySlot({
  slotIdx,
  hasMoreInQueue,
}: {
  slotIdx: number;
  hasMoreInQueue: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `slot:${slotIdx}` });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex min-h-[200px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/30 bg-card/30 p-6 text-center transition-colors",
        isOver && "border-primary/60 bg-primary/5"
      )}
    >
      <span className="rounded bg-secondary/40 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
        slot {slotIdx + 1}
      </span>
      <span className="text-[11px] text-muted-foreground">
        {hasMoreInQueue
          ? "Drop a Bench item here, or finish a slot to auto-fill."
          : "Empty — Bench is clear."}
      </span>
    </div>
  );
}

/**
 * Bench (formerly "Up next"): items selected for this sprint that aren't
 * in an active slot. Each card lifts on hover and reveals a popover
 * with full preview + source context + action buttons (Pull to slot,
 * Mark done, Detail). Drag-and-drop is preserved — drag handle lives
 * on the card itself so a click flow doesn't fight the drag flow.
 */
function BenchStrip({
  blocks,
  itemMap,
  draggingId,
  activeSlotsFull,
  onPull,
  onMarkDone,
  onOpen,
}: {
  blocks: SprintBlock[];
  itemMap: Map<string, S2DItem>;
  draggingId: string | null;
  activeSlotsFull: boolean;
  onPull: (id: string) => void;
  onMarkDone: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  // Whole strip is a fallback drop target — landing on the strip (not
  // on a specific card) appends to the end.
  const { setNodeRef: setDockRef, isOver: isDockOver } = useDroppable({
    id: "queue",
  });
  const empty = blocks.length === 0;
  return (
    <div
      ref={setDockRef}
      className={cn(
        "shrink-0 border-t border-border/30 bg-secondary/20 px-4 pt-2 pb-2 transition-colors",
        isDockOver && "bg-primary/5"
      )}
    >
      <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
        <ArrowDownToLine className="h-3 w-3" />
        Bench <span className="font-mono opacity-70">{blocks.length}</span>
        {!empty && (
          <span className="ml-2 normal-case text-[10px] opacity-60">
            Hover to preview · drag to slot · click to pull
          </span>
        )}
      </div>
      {empty ? (
        <div className="rounded border border-dashed border-border/30 px-3 py-2 text-[11px] text-muted-foreground">
          Bench is empty. Drag a slot here to park it.
        </div>
      ) : (
        // Two-layer overflow trick: the outer is overflow-visible so card
        // lifts (transform: translateY(-Npx)) aren't clipped. The inner
        // is overflow-x-auto for horizontal scroll, with generous vertical
        // padding so the lift stays inside its bounds. Without the
        // padding, the magnetic shadow gets sliced off at the strip's
        // top edge — that was the user-visible "Bench is cutting off"
        // bug from the redesign feedback.
        <div className="-mx-1 overflow-x-auto overflow-y-visible">
          <div className="flex items-end gap-3 px-1 pt-10 pb-6">
            {blocks.map((b) => {
              const it = itemMap.get(b.s2dItemId);
              if (!it) return null;
              return (
                <BenchCard
                  key={b.s2dItemId}
                  block={b}
                  item={it}
                  isDragging={draggingId === `queue:${b.s2dItemId}`}
                  activeSlotsFull={activeSlotsFull}
                  onPull={() => onPull(b.s2dItemId)}
                  onMarkDone={() => onMarkDone(b.s2dItemId)}
                  onOpen={() => onOpen(b.s2dItemId)}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function BenchCard({
  block,
  item,
  isDragging,
  activeSlotsFull,
  onPull,
  onMarkDone,
  onOpen,
}: {
  block: SprintBlock;
  item: S2DItem;
  isDragging: boolean;
  activeSlotsFull: boolean;
  onPull: () => void;
  onMarkDone: () => void;
  onOpen: () => void;
}) {
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `queue:${block.s2dItemId}`,
  });
  const {
    setNodeRef: setDragRef,
    attributes,
    listeners,
  } = useDraggable({ id: `queue:${block.s2dItemId}` });
  // Deck-card hover: bigger lift, sheen sweep, cursor-tracked tilt.
  // Halo color is the pathway's own CSS var so the glow matches the
  // badge — cosmetic continuity with the rest of the app's pathway
  // language. ref is composed with DnD setNodeRefs below.
  const pathwayMeta = PATHWAY_META[item.pathway];
  const glow = `var(${pathwayMeta.colorVar})`;
  const { ref: deckRef, onEnter, onMove, onLeave } = useDeckCardHover<HTMLDivElement>({
    shadow: `0 18px 44px -12px ${glow}, 0 0 0 1px ${glow}`,
    lift: 10,
    scale: 1.05,
  });
  const composedRef = (el: HTMLDivElement | null) => {
    setDropRef(el);
    setDragRef(el);
    deckRef.current = el;
  };
  // Hover-card pattern: open popover on hover-with-intent (~280ms) so
  // a quick mouseover doesn't trigger. The sheen + tilt feel instant
  // while the popover waits for clear hover intent.
  const [open, setOpen] = useState(false);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function startHover() {
    onEnter();
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => setOpen(true), 280);
  }
  function endHover() {
    onLeave();
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => setOpen(false), 120);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div
          ref={composedRef}
          onMouseEnter={startHover}
          onMouseMove={onMove}
          onMouseLeave={endHover}
          className={cn(
            // overflow-hidden clips the sheen sweep at the card edges;
            // will-change-transform hints the compositor for the tilt.
            "relative shrink-0 select-none overflow-hidden rounded-xl border bg-card text-[11px] will-change-transform",
            // Border uses pathway tint instead of generic border so the
            // resting card already announces what kind of work it is.
            "border-border/40 hover:border-transparent",
            isOver && "ring-2 ring-primary/60",
            isDragging && "opacity-40"
          )}
          style={{
            width: 224,
            height: 168,
            // Subtle pathway-tinted gradient bottom-to-top so the card
            // has visual depth at rest. Strength is low (0.10) — accent,
            // not statement.
            backgroundImage: `linear-gradient(165deg, transparent 40%, ${glow} 200%)`,
          }}
        >
          {/* Sheen overlay — animates left→right on hover via GSAP. The
              gradient is a thin diagonal band; the GSAP tween moves it
              across the card and fades it. Pointer-events-none so it
              doesn't eat clicks on the underlying content. */}
          <span
            data-sheen
            aria-hidden
            className="pointer-events-none absolute inset-0 z-20"
            style={{
              background:
                "linear-gradient(110deg, transparent 35%, rgba(255,255,255,0.16) 50%, transparent 65%)",
              transform: "translateX(-120%)",
            }}
          />

          {/* Top stat bar — drag handle + priority + ticket + duration */}
          <div className="relative z-10 flex items-center gap-1.5 border-b border-white/5 bg-black/20 px-2.5 py-1.5">
            <button
              type="button"
              {...listeners}
              {...attributes}
              className="cursor-grab touch-none rounded p-0.5 text-muted-foreground hover:bg-white/10 active:cursor-grabbing"
              title="Drag to reorder or promote to a slot"
              aria-label="Drag bench item"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <GripVertical className="h-3 w-3" />
            </button>
            <PriorityDot priority={item.priority} />
            <span className="font-mono text-[9px] text-muted-foreground">
              MASH-{item.ticket_number}
            </span>
            <span className="ml-auto rounded bg-black/30 px-1.5 py-0.5 font-mono text-[9px] text-foreground/85">
              {block.durationMin}m
            </span>
          </div>

          {/* Body — pathway badge as "rarity stripe", title, company */}
          <div className="relative z-10 flex h-[calc(100%-32px)] flex-col p-2.5">
            <div className="flex items-center gap-2">
              <PathwayBadge pathway={item.pathway} compact />
            </div>
            <div className="mt-1.5 line-clamp-3 text-[12px] font-medium leading-snug text-foreground/95">
              {item.title}
            </div>
            <div className="mt-auto flex items-center gap-1.5 pt-1">
              {item.company ? (
                <CompanyBadge company={item.company} />
              ) : (
                <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60">
                  no company
                </span>
              )}
            </div>
          </div>
        </div>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        onMouseEnter={() => {
          if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
          setOpen(true);
        }}
        onMouseLeave={endHover}
        className="w-[380px] space-y-2 p-3"
      >
        <div className="flex items-center gap-2">
          <PriorityDot priority={item.priority} />
          <span className="font-mono text-[10px] text-muted-foreground">
            MASH-{item.ticket_number}
          </span>
          <PathwayBadge pathway={item.pathway} compact />
          {item.company && <CompanyBadge company={item.company} />}
          <span className="ml-auto font-mono text-[10px] text-muted-foreground">
            {block.durationMin}m planned
          </span>
        </div>
        <div className="text-[13px] font-medium leading-snug text-foreground">
          {item.title}
        </div>
        {item.description && (
          <p className="line-clamp-3 text-[11px] text-muted-foreground">
            {item.description}
          </p>
        )}
        {/* Lazy-fetched source context — gated on `open` so we don't
            burn API calls for cards the user never hovers. */}
        <SprintItemContext item={item} enabled={open} />
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <Button size="sm" onClick={onPull} className="gap-1.5">
            <ArrowUpFromLine className="h-3.5 w-3.5" />
            {activeSlotsFull ? "Swap into slot" : "Pull to slot"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onMarkDone}
            className="gap-1.5"
          >
            <CheckCheck className="h-3.5 w-3.5" />
            Mark done
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onOpen}
            className="ml-auto gap-1.5 text-muted-foreground"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Detail
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function DragGhost({
  block,
  item,
  paused,
}: {
  block: SprintBlock;
  item: S2DItem;
  paused: boolean;
}) {
  const elapsedMs = blockLiveElapsedMs(block, paused);
  const totalMs = block.durationMin * 60_000;
  const remainingMs = Math.max(0, totalMs - elapsedMs);
  return (
    <div className="pointer-events-none rounded-md border border-primary/40 bg-card px-3 py-2 text-[11px] shadow-2xl">
      <div className="flex items-center gap-1.5">
        <GripVertical className="h-2.5 w-2.5 text-muted-foreground" />
        <span className="font-mono text-[9px] text-muted-foreground">
          MASH-{item.ticket_number}
        </span>
        <PriorityDot priority={item.priority} />
        <span className="font-mono text-[9px] text-muted-foreground">
          {fmtMs(remainingMs)}
        </span>
      </div>
      <div className="line-clamp-1 max-w-[260px] pt-0.5 text-foreground/85">
        {item.title}
      </div>
    </div>
  );
}

/**
 * Done: completed (or skipped) blocks. Each card lifts on hover and
 * reveals a popover with the outcome + reopen affordances. Un-finishing
 * goes through the PATCH endpoint so done_at + outcome + resolved_via
 * get cleared server-side.
 */
function DoneStrip({
  blocks,
  itemMap,
  activeSlotsFull,
  onReopen,
  onOpen,
}: {
  blocks: SprintBlock[];
  itemMap: Map<string, S2DItem>;
  activeSlotsFull: boolean;
  onReopen: (id: string, target: "active" | "bench") => void;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="shrink-0 border-t border-border/30 px-4 pt-2 pb-2">
      <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
        <CheckCheck className="h-3 w-3" />
        Done <span className="font-mono opacity-70">{blocks.length}</span>
      </div>
      {/* Two-layer overflow so card lifts don't clip — same pattern as
          the Bench strip. */}
      <div className="-mx-1 overflow-x-auto overflow-y-visible">
        <div className="flex items-end gap-3 px-1 pt-10 pb-6">
          {blocks.map((b) => {
            const it = itemMap.get(b.s2dItemId);
            if (!it) return null;
            return (
              <DoneCard
                key={b.s2dItemId}
                block={b}
                item={it}
                activeSlotsFull={activeSlotsFull}
                onReopen={(target) => onReopen(b.s2dItemId, target)}
                onOpen={() => onOpen(b.s2dItemId)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function DoneCard({
  block,
  item,
  activeSlotsFull,
  onReopen,
  onOpen,
}: {
  block: SprintBlock;
  item: S2DItem;
  activeSlotsFull: boolean;
  onReopen: (target: "active" | "bench") => void;
  onOpen: () => void;
}) {
  const isDone = block.status === "done";
  // Done cards use emerald glow; skipped use muted. Matches the badge
  // language elsewhere in the app (S2D sheet, sprint complete recap).
  const glow = isDone
    ? "rgb(16 185 129 / 0.55)"
    : "hsl(var(--muted-foreground) / 0.35)";
  const { ref, onEnter, onMove, onLeave } = useDeckCardHover<HTMLDivElement>({
    shadow: `0 18px 44px -12px ${glow}, 0 0 0 1px ${glow}`,
    lift: 10,
    scale: 1.05,
  });
  const [open, setOpen] = useState(false);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function startHover() {
    onEnter();
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => setOpen(true), 280);
  }
  function endHover() {
    onLeave();
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => setOpen(false), 120);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div
          ref={ref}
          onMouseEnter={startHover}
          onMouseMove={onMove}
          onMouseLeave={endHover}
          className={cn(
            "relative shrink-0 cursor-pointer select-none overflow-hidden rounded-xl border text-[11px] will-change-transform",
            isDone
              ? "border-emerald-500/30 bg-emerald-500/5 hover:border-transparent"
              : "border-border/40 bg-card/50 hover:border-transparent"
          )}
          style={{
            width: 224,
            height: 168,
            backgroundImage: isDone
              ? "linear-gradient(165deg, transparent 40%, rgb(16 185 129 / 0.18) 200%)"
              : "linear-gradient(165deg, transparent 40%, hsl(var(--muted-foreground) / 0.10) 200%)",
          }}
        >
          {/* Sheen sweep on hover */}
          <span
            data-sheen
            aria-hidden
            className="pointer-events-none absolute inset-0 z-20"
            style={{
              background:
                "linear-gradient(110deg, transparent 35%, rgba(255,255,255,0.16) 50%, transparent 65%)",
              transform: "translateX(-120%)",
            }}
          />

          {/* Top stat bar */}
          <div className="relative z-10 flex items-center gap-1.5 border-b border-white/5 bg-black/20 px-2.5 py-1.5">
            {isDone ? (
              <Check className="h-3 w-3 text-emerald-400" />
            ) : (
              <SkipForward className="h-3 w-3 text-muted-foreground" />
            )}
            <span
              className={cn(
                "font-mono text-[9px]",
                isDone ? "text-emerald-300/85" : "text-muted-foreground"
              )}
            >
              MASH-{item.ticket_number}
            </span>
            <span className="ml-auto rounded bg-black/30 px-1.5 py-0.5 font-mono text-[9px] text-foreground/85">
              {block.durationMin}m
            </span>
          </div>

          {/* Body */}
          <div className="relative z-10 flex h-[calc(100%-32px)] flex-col p-2.5">
            <div className="flex items-center gap-1.5">
              <PathwayBadge pathway={item.pathway} compact />
              <span
                className={cn(
                  "ml-auto rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wider",
                  isDone
                    ? "bg-emerald-500/15 text-emerald-300"
                    : "bg-secondary/60 text-muted-foreground"
                )}
              >
                {isDone ? "done" : "skipped"}
              </span>
            </div>
            <div
              className={cn(
                "mt-1.5 line-clamp-3 text-[12px] font-medium leading-snug",
                isDone ? "text-emerald-200/95" : "text-muted-foreground"
              )}
            >
              {item.title}
            </div>
            <div className="mt-auto flex items-center gap-1.5 pt-1">
              {item.company && <CompanyBadge company={item.company} />}
            </div>
          </div>
        </div>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        onMouseEnter={() => {
          if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
          setOpen(true);
        }}
        onMouseLeave={endHover}
        className="w-[360px] space-y-2 p-3"
      >
        <div className="flex items-center gap-2">
          {isDone ? (
            <Check className="h-3.5 w-3.5 text-emerald-400" />
          ) : (
            <SkipForward className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          <span className="font-mono text-[10px] text-muted-foreground">
            MASH-{item.ticket_number}
          </span>
          <PathwayBadge pathway={item.pathway} compact />
          {item.company && <CompanyBadge company={item.company} />}
          <span className="ml-auto rounded bg-secondary/60 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">
            {isDone ? "done" : "skipped"}
          </span>
        </div>
        <div className="text-[13px] font-medium leading-snug text-foreground">
          {item.title}
        </div>
        {item.outcome && (
          <div className="rounded border border-border/40 bg-secondary/30 p-2 text-[11px] text-foreground/85">
            <div className="mb-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">
              Outcome
            </div>
            {item.outcome}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <Button
            size="sm"
            variant="outline"
            onClick={() => onReopen("active")}
            className="gap-1.5"
            title={
              activeSlotsFull
                ? "All slots full — will land on the Bench"
                : "Send back into an active slot"
            }
          >
            <Undo2 className="h-3.5 w-3.5" />
            Reopen to slot
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onReopen("bench")}
            className="gap-1.5 text-muted-foreground"
            title="Reopen but park on the Bench"
          >
            <ArrowDownToLine className="h-3.5 w-3.5" />
            Reopen to Bench
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onOpen}
            className="ml-auto gap-1.5 text-muted-foreground"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Detail
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function fmtMs(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}
