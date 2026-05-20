"use client";

/**
 * Stage 2 — sprint SETUP for multi-active (parallel) mode.
 *
 * Replaces the old sequential-timeline scheduler. In parallel mode there
 * is no per-block "start at": up to MAX_PARALLEL_SLOTS items run
 * concurrently when the user presses Start, and the rest sit in a
 * rolling queue that auto-promotes on Done/Skip.
 *
 * What this page does:
 *   - Splits the selected items into "starting slots" (the first
 *     MAX_PARALLEL_SLOTS, locked-in when the sprint starts) and "queue"
 *     (everything else).
 *   - Lets the user drag between the two lists, and within each list,
 *     to control which items are in slots first.
 *   - Lets the user adjust each block's durationMin (the per-block time
 *     budget the active-mode timer counts against).
 *
 * SprintBlock interface is preserved as-is. `startAt` is vestigial in
 * parallel mode but we still set it to "now" so any downstream code
 * reading it (e.g. calendar event create — also vestigial for parallel
 * but still wired) doesn't crash on undefined.
 */

import { useEffect, useMemo } from "react";
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
import { useState } from "react";
import { useS2DItems } from "@/hooks/use-s2d";
import {
  useSprintStore,
  MAX_PARALLEL_SLOTS,
  type SprintBlock,
} from "@/store/sprint-store";
import { Button } from "@/components/ui/button";
import { ArrowRight, ArrowLeft, GripVertical, Zap } from "lucide-react";
import { PathwayBadge } from "@/components/shared/pathway-badge";
import { PriorityDot } from "@/components/shared/priority-dot";
import { PlannerHeader } from "./planner-prioritize";
import type { S2DItem } from "@/types";
import { cn } from "@/lib/utils";

export function PlannerSchedule() {
  const { data: items } = useS2DItems();
  const selectedIds = useSprintStore((s) => s.selectedItemIds);
  const blocks = useSprintStore((s) => s.blocks);
  const setBlocks = useSprintStore((s) => s.setBlocks);
  const updateBlock = useSprintStore((s) => s.updateBlock);
  const setPhase = useSprintStore((s) => s.setPhase);
  const exit = useSprintStore((s) => s.exitSprint);

  const itemMap = useMemo(
    () => new Map((items ?? []).map((i) => [i.id, i])),
    [items]
  );

  // Initialize blocks from selection on first arrival. Preserve any
  // existing block edits if the user comes back via Back from Review.
  useEffect(() => {
    if (
      blocks.length === selectedIds.length &&
      blocks.every((b, i) => b.s2dItemId === selectedIds[i])
    ) {
      return;
    }
    setBlocks(initialBlocks(selectedIds, itemMap));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds]);

  // The first MAX_PARALLEL_SLOTS blocks are the "starting slots"; the
  // rest are queued. This mirrors what sprint-store.startSprint() does
  // when it transitions to active mode — keeping the visualization here
  // 1:1 with the runtime outcome.
  const startingSlots = blocks.slice(0, MAX_PARALLEL_SLOTS);
  const queuedBlocks = blocks.slice(MAX_PARALLEL_SLOTS);

  function moveBetween(srcId: string, destZone: "slots" | "queue", destIdx: number) {
    const srcIdx = blocks.findIndex((b) => b.s2dItemId === srcId);
    if (srcIdx < 0) return;
    const next = blocks.slice();
    const [moved] = next.splice(srcIdx, 1);
    if (destZone === "slots") {
      const clamped = Math.max(0, Math.min(destIdx, MAX_PARALLEL_SLOTS));
      next.splice(clamped, 0, moved);
    } else {
      // Queue starts at index MAX_PARALLEL_SLOTS in blocks[]
      const target = MAX_PARALLEL_SLOTS + destIdx;
      const clamped = Math.max(MAX_PARALLEL_SLOTS, Math.min(target, next.length));
      next.splice(clamped, 0, moved);
    }
    setBlocks(next);
  }

  function bumpDuration(s2dItemId: string, delta: number) {
    const cur = blocks.find((b) => b.s2dItemId === s2dItemId);
    if (!cur) return;
    updateBlock(s2dItemId, { durationMin: Math.max(10, cur.durationMin + delta) });
  }

  function autoFitDurations() {
    // Reset each block to its item's est_minutes (or 30 fallback). Order
    // is preserved.
    const next = blocks.map((b) => ({
      ...b,
      durationMin: itemMap.get(b.s2dItemId)?.est_minutes ?? 30,
    }));
    setBlocks(next);
  }

  // ── DnD ───────────────────────────────────────────────────────────
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  function onDragStart(e: DragStartEvent) {
    setDraggingId(String(e.active.id));
  }
  function onDragEnd(e: DragEndEvent) {
    const activeId = String(e.active.id);
    setDraggingId(null);
    if (!e.over) return;
    const overId = String(e.over.id);
    if (activeId === overId) return;
    // ids are `block:<s2dItemId>`; droppables are `slot:<idx>`,
    // `slots-end`, `queue:<s2dItemId>`, `queue-end`.
    if (!activeId.startsWith("block:")) return;
    const srcId = activeId.slice(6);
    if (overId.startsWith("slot:")) {
      const idx = parseInt(overId.slice(5), 10);
      if (!Number.isNaN(idx)) moveBetween(srcId, "slots", idx);
      return;
    }
    if (overId === "slots-end") {
      moveBetween(srcId, "slots", startingSlots.length);
      return;
    }
    if (overId.startsWith("queue:")) {
      const targetId = overId.slice(6);
      const targetIdx = queuedBlocks.findIndex((b) => b.s2dItemId === targetId);
      if (targetIdx >= 0) moveBetween(srcId, "queue", targetIdx);
      return;
    }
    if (overId === "queue-end" || overId === "queue") {
      moveBetween(srcId, "queue", queuedBlocks.length);
      return;
    }
  }

  const draggingBlock = useMemo(() => {
    if (!draggingId?.startsWith("block:")) return null;
    const id = draggingId.slice(6);
    const block = blocks.find((b) => b.s2dItemId === id);
    if (!block) return null;
    const item = itemMap.get(id) ?? null;
    return item ? { block, item } : null;
  }, [draggingId, blocks, itemMap]);

  return (
    <div className="flex h-full flex-col">
      <PlannerHeader phase="schedule" onCancel={exit} />

      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="flex-1 overflow-y-auto p-4">
          <div className="mx-auto max-w-3xl space-y-4">
            <div className="rounded-md border border-border/40 bg-card p-3 text-[12px] text-muted-foreground">
              Mashi runs up to <span className="text-foreground">{MAX_PARALLEL_SLOTS}</span>{" "}
              items in parallel slots when you press Start. The rest sit in the queue and
              auto-promote each time you finish or skip a slot. Drag to choose which items
              start in slots — and what they pull from next.
            </div>

            {/* Starting slots — exactly MAX_PARALLEL_SLOTS, with a trailing
                drop zone for "move to end of slots" when the user has
                fewer than the cap selected. */}
            <section>
              <SectionHeader
                title="Starting slots"
                subtitle={`First ${MAX_PARALLEL_SLOTS} run concurrently when the sprint starts`}
              />
              <div className="space-y-1.5">
                {Array.from({ length: MAX_PARALLEL_SLOTS }).map((_, slotIdx) => {
                  const block = startingSlots[slotIdx];
                  return (
                    <SlotRow
                      key={slotIdx}
                      slotIdx={slotIdx}
                      block={block}
                      item={block ? itemMap.get(block.s2dItemId) ?? null : null}
                      onBump={bumpDuration}
                      isDragging={
                        block != null && draggingId === `block:${block.s2dItemId}`
                      }
                    />
                  );
                })}
              </div>
            </section>

            {/* Queue */}
            <section>
              <div className="flex items-center justify-between">
                <SectionHeader
                  title={`Queue (${queuedBlocks.length})`}
                  subtitle="Auto-promotes to a slot on Done or Skip"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={autoFitDurations}
                  className="gap-1.5"
                  title="Reset each duration to the item's est_minutes"
                >
                  <Zap className="h-3.5 w-3.5" />
                  Auto-fit durations
                </Button>
              </div>
              <QueueZone blocks={queuedBlocks} itemMap={itemMap} draggingId={draggingId} onBump={bumpDuration} />
            </section>

            <SummaryBar blocks={blocks} />
          </div>
        </div>

        <DragOverlay dropAnimation={null}>
          {draggingBlock ? (
            <DragGhost block={draggingBlock.block} item={draggingBlock.item} />
          ) : null}
        </DragOverlay>
      </DndContext>

      <div className="flex items-center justify-between gap-2 border-t border-border/40 px-4 py-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setPhase("prioritize")}
          className="gap-1.5"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={exit}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={blocks.length === 0}
            onClick={() => setPhase("review")}
            className="gap-1.5"
          >
            Review
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-1.5">
      <div className="text-[11px] uppercase tracking-wider text-foreground">{title}</div>
      <div className="text-[10px] text-muted-foreground">{subtitle}</div>
    </div>
  );
}

function SlotRow({
  slotIdx,
  block,
  item,
  isDragging,
  onBump,
}: {
  slotIdx: number;
  block: SprintBlock | undefined;
  item: S2DItem | null;
  isDragging: boolean;
  onBump: (id: string, delta: number) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `slot:${slotIdx}` });
  if (!block || !item) {
    return (
      <div
        ref={setNodeRef}
        className={cn(
          "flex items-center gap-3 rounded-md border border-dashed border-border/40 bg-card/30 px-3 py-3 text-[11px] text-muted-foreground transition-colors",
          isOver && "border-primary/60 bg-primary/5"
        )}
      >
        <span className="rounded bg-secondary/40 px-1.5 py-0.5 font-mono text-[10px]">
          slot {slotIdx + 1}
        </span>
        <span>Drop a queued item here to start it in this slot.</span>
      </div>
    );
  }
  return (
    <BlockRow
      droppableId={`slot:${slotIdx}`}
      draggableId={`block:${block.s2dItemId}`}
      block={block}
      item={item}
      isDragging={isDragging}
      isOver={isOver}
      setNodeRef={setNodeRef}
      onBump={onBump}
      badge={
        <span className="rounded bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-primary">
          slot {slotIdx + 1}
        </span>
      }
    />
  );
}

function QueueZone({
  blocks,
  itemMap,
  draggingId,
  onBump,
}: {
  blocks: SprintBlock[];
  itemMap: Map<string, S2DItem>;
  draggingId: string | null;
  onBump: (id: string, delta: number) => void;
}) {
  // Trailing "drop here to land at the end" zone — needed even when the
  // queue is empty so the user can move a starting-slot item out.
  const { setNodeRef: setEndRef, isOver: isEndOver } = useDroppable({
    id: "queue-end",
  });
  return (
    <div className="space-y-1.5">
      {blocks.map((b) => {
        const it = itemMap.get(b.s2dItemId);
        if (!it) return null;
        return (
          <QueueRow
            key={b.s2dItemId}
            block={b}
            item={it}
            isDragging={draggingId === `block:${b.s2dItemId}`}
            onBump={onBump}
          />
        );
      })}
      <div
        ref={setEndRef}
        className={cn(
          "rounded-md border border-dashed border-border/30 px-3 py-2 text-[10px] text-muted-foreground transition-colors",
          isEndOver && "border-primary/60 bg-primary/5",
          blocks.length === 0 && "py-3"
        )}
      >
        {blocks.length === 0
          ? "Queue empty — drop an item here to move it out of the starting slots."
          : "Drop here to send to end of queue."}
      </div>
    </div>
  );
}

function QueueRow({
  block,
  item,
  isDragging,
  onBump,
}: {
  block: SprintBlock;
  item: S2DItem;
  isDragging: boolean;
  onBump: (id: string, delta: number) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `queue:${block.s2dItemId}` });
  return (
    <BlockRow
      droppableId={`queue:${block.s2dItemId}`}
      draggableId={`block:${block.s2dItemId}`}
      block={block}
      item={item}
      isDragging={isDragging}
      isOver={isOver}
      setNodeRef={setNodeRef}
      onBump={onBump}
    />
  );
}

function BlockRow({
  droppableId: _droppableId,
  draggableId,
  block,
  item,
  isDragging,
  isOver,
  setNodeRef,
  onBump,
  badge,
}: {
  droppableId: string;
  draggableId: string;
  block: SprintBlock;
  item: S2DItem;
  isDragging: boolean;
  isOver: boolean;
  setNodeRef: (el: HTMLElement | null) => void;
  onBump: (id: string, delta: number) => void;
  badge?: React.ReactNode;
}) {
  void _droppableId;
  const {
    setNodeRef: setDragRef,
    attributes,
    listeners,
  } = useDraggable({ id: draggableId });
  const composedRef = (el: HTMLDivElement | null) => {
    setNodeRef(el);
    setDragRef(el);
  };
  return (
    <div
      ref={composedRef}
      className={cn(
        "flex items-center gap-3 rounded-md border border-border/40 bg-card p-3 transition-colors",
        isOver && "ring-2 ring-primary/60",
        isDragging && "opacity-50"
      )}
    >
      <button
        type="button"
        {...listeners}
        {...attributes}
        className="cursor-grab touch-none rounded p-0.5 text-muted-foreground hover:bg-secondary active:cursor-grabbing"
        title="Drag to move"
        aria-label="Drag block"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      {badge}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[10px] text-muted-foreground">
            MASH-{item.ticket_number}
          </span>
          <PriorityDot priority={item.priority} />
          <PathwayBadge pathway={item.pathway} />
        </div>
        <div className="line-clamp-1 text-[13px] text-foreground/90">{item.title}</div>
      </div>
      <div className="flex items-center gap-0.5">
        <button
          onClick={() => onBump(block.s2dItemId, -10)}
          className="rounded border border-border/40 px-1.5 text-[11px] hover:bg-accent"
          aria-label="Decrease duration"
        >
          −
        </button>
        <span className="w-12 text-center font-mono text-[11px]">{block.durationMin}m</span>
        <button
          onClick={() => onBump(block.s2dItemId, 10)}
          className="rounded border border-border/40 px-1.5 text-[11px] hover:bg-accent"
          aria-label="Increase duration"
        >
          +
        </button>
      </div>
    </div>
  );
}

function DragGhost({ block, item }: { block: SprintBlock; item: S2DItem }) {
  return (
    <div className="pointer-events-none rounded-md border border-primary/40 bg-card p-2 text-[11px] shadow-2xl">
      <div className="flex items-center gap-1.5">
        <GripVertical className="h-2.5 w-2.5 text-muted-foreground" />
        <span className="font-mono text-[9px] text-muted-foreground">
          MASH-{item.ticket_number}
        </span>
        <PriorityDot priority={item.priority} />
        <span className="font-mono text-[9px] text-muted-foreground">{block.durationMin}m</span>
      </div>
      <div className="line-clamp-1 max-w-[260px] pt-0.5 text-foreground/85">{item.title}</div>
    </div>
  );
}

function SummaryBar({ blocks }: { blocks: SprintBlock[] }) {
  const totalMin = blocks.reduce((sum, b) => sum + b.durationMin, 0);
  return (
    <div className="rounded-md border border-border/40 bg-secondary/30 p-3 text-[12px] text-muted-foreground">
      {blocks.length} item{blocks.length === 1 ? "" : "s"} ·{" "}
      <span className="text-foreground">{totalMin}m</span> total time budget
      {blocks.length > MAX_PARALLEL_SLOTS && (
        <>
          {" "}
          ·{" "}
          <span className="text-foreground">{MAX_PARALLEL_SLOTS}</span> start in slots,
          rest auto-promote
        </>
      )}
    </div>
  );
}

function initialBlocks(
  selectedIds: string[],
  itemMap: Map<string, { est_minutes?: number | null }>
): SprintBlock[] {
  const startIso = new Date().toISOString();
  return selectedIds.map((id) => ({
    s2dItemId: id,
    // `startAt` is vestigial in parallel mode — but downstream code
    // (calendar event create) still reads it. Set to now() so anything
    // that does `new Date(b.startAt)` succeeds.
    startAt: startIso,
    durationMin: itemMap.get(id)?.est_minutes ?? 30,
    status: "pending",
  }));
}
