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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useSprintStore,
  blockLiveElapsedMs,
  MAX_PARALLEL_SLOTS,
  type SprintBlock,
} from "@/store/sprint-store";
import { useS2DItems, useUpdateS2DItem } from "@/hooks/use-s2d";
import { useS2DStore } from "@/store/s2d-store";
import { PathwayBadge } from "@/components/shared/pathway-badge";
import { PriorityDot } from "@/components/shared/priority-dot";
import { CompanyBadge } from "@/components/shared/company-badge";
import { SprintContextPackage } from "@/components/sprint/sprint-context-package";
import { cn } from "@/lib/utils";

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

  const updateItem = useUpdateS2DItem();
  const { data: items } = useS2DItems();
  const setSelected = useS2DStore((s) => s.setSelectedItem);

  // Tick once per second to drive the live timers.
  const [, force] = useState(0);
  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => force((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, [paused]);

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

  function markDone(s2dItemId: string) {
    updateItem.mutate({
      id: s2dItemId,
      patch: {
        status: "done",
        outcome: "Completed in sprint",
        resolved_via: "manual",
      },
    });
    completeBlock(s2dItemId, "done");
  }
  function skip(s2dItemId: string) {
    updateItem.mutate({ id: s2dItemId, patch: { status: "todo" } });
    completeBlock(s2dItemId, "skipped");
  }
  function snooze(s2dItemId: string) {
    const t = new Date();
    t.setDate(t.getDate() + 1);
    t.setHours(9, 0, 0, 0);
    updateItem.mutate({
      id: s2dItemId,
      patch: {
        status: "in_queue",
        snoozed_until: t.toISOString(),
        queue_reason: "Snoozed mid-sprint (24h)",
      },
    });
    completeBlock(s2dItemId, "skipped");
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
  }, [activeSlotIds, paused]);

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
              onDone={() => markDone(block.s2dItemId)}
              onSkip={() => skip(block.s2dItemId)}
              onSnooze={() => snooze(block.s2dItemId)}
              onOpen={() => setSelected(block.s2dItemId)}
            />
          );
        })}
      </div>

      {/* Queue dock */}
      {queuedBlocks.length > 0 && (
        <QueueDock blocks={queuedBlocks} itemMap={itemMap} />
      )}

      {/* Done strip */}
      {completedBlocks.length > 0 && (
        <CompletedStrip blocks={completedBlocks} itemMap={itemMap} />
      )}
    </div>
  );
}

function SlotCard({
  slotIdx,
  block,
  item,
  paused,
  onDone,
  onSkip,
  onSnooze,
  onOpen,
}: {
  slotIdx: number;
  block: SprintBlock;
  item: import("@/types").S2DItem;
  paused: boolean;
  onDone: () => void;
  onSkip: () => void;
  onSnooze: () => void;
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

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-xl border bg-card shadow-md transition-colors",
        overrunMs > 0
          ? "border-destructive/60"
          : paused
            ? "border-border/40"
            : "border-primary/40"
      )}
    >
      {/* Slot header strip */}
      <div className="flex items-center gap-2 border-b border-border/30 bg-secondary/30 px-3 py-1.5">
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

        {/* Context package — collapsed by default so 3 slots fit on screen.
            User opens detail panel via the link below for full context. */}
        <div className="mt-3 flex-1">
          <SprintContextPackage item={item} />
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
  return (
    <div className="flex min-h-[200px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/30 bg-card/30 p-6 text-center">
      <span className="rounded bg-secondary/40 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
        slot {slotIdx + 1}
      </span>
      <span className="text-[11px] text-muted-foreground">
        {hasMoreInQueue
          ? "Finish another slot to pull the next item in."
          : "Empty — queue is clear."}
      </span>
    </div>
  );
}

function QueueDock({
  blocks,
  itemMap,
}: {
  blocks: SprintBlock[];
  itemMap: Map<string, import("@/types").S2DItem>;
}) {
  return (
    <div className="shrink-0 border-t border-border/30 bg-secondary/20 px-4 py-2">
      <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        Up next ({blocks.length})
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {blocks.map((b) => {
          const it = itemMap.get(b.s2dItemId);
          if (!it) return null;
          return (
            <div
              key={b.s2dItemId}
              className="shrink-0 rounded-md border border-border/30 bg-card/60 px-3 py-2 text-[11px]"
            >
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-[9px] text-muted-foreground">
                  MASH-{it.ticket_number}
                </span>
                <PriorityDot priority={it.priority} />
                <span className="font-mono text-[9px] text-muted-foreground">
                  {b.durationMin}m
                </span>
              </div>
              <div className="line-clamp-1 max-w-[260px] pt-0.5 text-foreground/85">
                {it.title}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CompletedStrip({
  blocks,
  itemMap,
}: {
  blocks: SprintBlock[];
  itemMap: Map<string, import("@/types").S2DItem>;
}) {
  return (
    <div className="shrink-0 border-t border-border/30 px-4 py-2">
      <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        Done this sprint ({blocks.length})
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {blocks.map((b) => {
          const it = itemMap.get(b.s2dItemId);
          if (!it) return null;
          return (
            <div
              key={b.s2dItemId}
              className={cn(
                "shrink-0 rounded-md border px-2.5 py-1 text-[10px]",
                b.status === "done"
                  ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-200/85"
                  : "border-border/30 bg-card/50 text-muted-foreground"
              )}
            >
              {b.status === "done" ? (
                <Check className="mr-1 inline-block h-2.5 w-2.5" />
              ) : (
                <SkipForward className="mr-1 inline-block h-2.5 w-2.5" />
              )}
              MASH-{it.ticket_number}
              <span className="ml-1 line-clamp-1 inline-block max-w-[180px] align-middle">
                {it.title}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function fmtMs(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}
