"use client";

import { useEffect, useMemo } from "react";
import { useS2DItems } from "@/hooks/use-s2d";
import { useSprintStore, type SprintBlock } from "@/store/sprint-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowRight, ArrowLeft, Zap } from "lucide-react";
import { PathwayBadge } from "@/components/shared/pathway-badge";
import { PlannerHeader } from "./planner-prioritize";

/**
 * Stage 2: assign start times + durations to each selected item.
 *
 * On entry, auto-fits blocks back-to-back starting from the next half-hour.
 * User can edit start time and duration per block. No drag-on-timeline in
 * v1 — back-to-back blocks with editable fields covers 90% of use.
 */
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

  // Auto-fit on first arrival
  useEffect(() => {
    if (blocks.length === selectedIds.length && blocks.every((b, i) => b.s2dItemId === selectedIds[i])) {
      return; // already aligned with selection
    }
    setBlocks(autoFitBlocks(selectedIds, itemMap));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds]);

  const totalMin = blocks.reduce((sum, b) => sum + b.durationMin, 0);
  const lastEnd =
    blocks.length > 0
      ? new Date(
          new Date(blocks[blocks.length - 1].startAt).getTime() +
            blocks[blocks.length - 1].durationMin * 60_000
        )
      : null;

  function rebaseFrom(first: string) {
    // Recompute every block's startAt from the first block's startAt
    // forward, keeping each block's durationMin.
    const startTime = new Date(first);
    if (isNaN(startTime.getTime())) return;
    let cursor = startTime.getTime();
    const next = blocks.map((b) => {
      const startAt = new Date(cursor).toISOString();
      cursor += b.durationMin * 60_000;
      return { ...b, startAt };
    });
    setBlocks(next);
  }

  function bumpDuration(s2dItemId: string, delta: number) {
    const i = blocks.findIndex((b) => b.s2dItemId === s2dItemId);
    if (i === -1) return;
    const newDur = Math.max(10, blocks[i].durationMin + delta);
    // Update target block, then re-cascade subsequent start times
    const next = blocks.slice();
    next[i] = { ...next[i], durationMin: newDur };
    let cursor = new Date(next[i].startAt).getTime() + next[i].durationMin * 60_000;
    for (let j = i + 1; j < next.length; j++) {
      next[j] = { ...next[j], startAt: new Date(cursor).toISOString() };
      cursor += next[j].durationMin * 60_000;
    }
    setBlocks(next);
  }

  function autoFit() {
    setBlocks(autoFitBlocks(selectedIds, itemMap));
  }

  return (
    <div className="flex h-full flex-col">
      <PlannerHeader phase="schedule" onCancel={exit} />

      <div className="flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-3xl space-y-3">
          <div className="flex items-center gap-3 rounded-md border border-border/40 bg-card p-3 text-[12px]">
            <span className="text-muted-foreground">Start the sprint at</span>
            <Input
              type="datetime-local"
              value={isoToLocalInput(blocks[0]?.startAt ?? new Date().toISOString())}
              onChange={(e) => rebaseFrom(localInputToISO(e.target.value))}
              className="h-8 w-56 text-[12px]"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={autoFit}
              className="ml-auto gap-1.5"
            >
              <Zap className="h-3.5 w-3.5" />
              Auto-fit
            </Button>
          </div>

          <ol className="space-y-2">
            {blocks.map((b, i) => {
              const it = itemMap.get(b.s2dItemId);
              if (!it) return null;
              const start = new Date(b.startAt);
              const end = new Date(start.getTime() + b.durationMin * 60_000);
              return (
                <li
                  key={b.s2dItemId}
                  className="flex items-center gap-3 rounded-md border border-border/40 bg-card p-3"
                >
                  <span className="font-mono text-[10px] text-muted-foreground w-6">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[10px] text-muted-foreground">
                        MASH-{it.ticket_number}
                      </span>
                      <PathwayBadge pathway={it.pathway} />
                    </div>
                    <div className="line-clamp-1 text-[13px] text-foreground/90">
                      {it.title}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 text-[11px] font-mono text-muted-foreground">
                    <span>{fmtClock(start)}</span>
                    <span>→</span>
                    <span>{fmtClock(end)}</span>
                  </div>
                  <div className="flex items-center gap-0.5">
                    <button
                      onClick={() => bumpDuration(b.s2dItemId, -10)}
                      className="rounded border border-border/40 px-1.5 text-[11px] hover:bg-accent"
                    >
                      −
                    </button>
                    <span className="w-12 text-center text-[11px] font-mono">
                      {b.durationMin}m
                    </span>
                    <button
                      onClick={() => bumpDuration(b.s2dItemId, 10)}
                      className="rounded border border-border/40 px-1.5 text-[11px] hover:bg-accent"
                    >
                      +
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>

          {blocks.length > 0 && lastEnd && (
            <div className="rounded-md border border-border/40 bg-secondary/30 p-3 text-[12px] text-muted-foreground">
              Sprint runs {totalMin} minutes ({(totalMin / 60).toFixed(1)}h) ·
              wraps at <span className="font-mono">{fmtClock(lastEnd)}</span>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-border/40 px-4 py-3">
        <Button variant="ghost" size="sm" onClick={() => setPhase("prioritize")} className="gap-1.5">
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

function autoFitBlocks(
  selectedIds: string[],
  itemMap: Map<string, { est_minutes?: number | null }>
): SprintBlock[] {
  const start = nextHalfHour();
  let cursor = start.getTime();
  const blocks: SprintBlock[] = [];
  for (const id of selectedIds) {
    const dur = itemMap.get(id)?.est_minutes ?? 30;
    blocks.push({
      s2dItemId: id,
      startAt: new Date(cursor).toISOString(),
      durationMin: dur,
      status: "pending",
    });
    cursor += dur * 60_000;
  }
  return blocks;
}

function nextHalfHour(): Date {
  const d = new Date();
  d.setSeconds(0, 0);
  const m = d.getMinutes();
  if (m === 0 || m === 30) {
    d.setMinutes(m + 30);
  } else if (m < 30) {
    d.setMinutes(30);
  } else {
    d.setMinutes(0);
    d.setHours(d.getHours() + 1);
  }
  return d;
}

function fmtClock(d: Date): string {
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function localInputToISO(local: string): string {
  return new Date(local).toISOString();
}
