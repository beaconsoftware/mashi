"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useS2DItems } from "@/hooks/use-s2d";
import { useSprintStore, blockLiveElapsedMs } from "@/store/sprint-store";
import { Maximize2, Check, Pause, Play, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useGSAP } from "@gsap/react";
import { slideUp } from "@/lib/animation";
import { Button } from "@/components/ui/button";

/**
 * Sticky floating widget for minimized sprint state. Shows the first active
 * slot's task + live countdown, with a slot-count chip when multiple slots
 * are running concurrently. Click maximize to re-enter the full takeover.
 *
 * Why first active slot: in multi-active mode, the user has up to 3 things
 * running at once. A single-line widget can't show all three; surfacing the
 * top slot + "1/3 active" chip gives enough at-a-glance status to decide
 * whether to maximize. The Done button completes the first slot specifically;
 * the user can maximize for finer control.
 */
export function SprintWidget() {
  const phase = useSprintStore((s) => s.phase);
  const blocks = useSprintStore((s) => s.blocks);
  const activeSlotIds = useSprintStore((s) => s.activeSlotIds);
  const paused = useSprintStore((s) => s.paused);
  const unminimize = useSprintStore((s) => s.unminimize);
  const completeBlock = useSprintStore((s) => s.completeBlock);
  const pause = useSprintStore((s) => s.pause);
  const resume = useSprintStore((s) => s.resume);
  const exitSprint = useSprintStore((s) => s.exitSprint);

  const { data: items } = useS2DItems();
  const itemMap = useMemo(
    () => new Map((items ?? []).map((i) => [i.id, i])),
    [items]
  );

  const [, force] = useState(0);
  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => force((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, [paused]);

  const widgetRef = useRef<HTMLDivElement | null>(null);
  useGSAP(
    () => {
      if (phase === "minimized" && widgetRef.current) {
        slideUp(widgetRef.current);
      }
    },
    { dependencies: [phase] }
  );

  if (phase !== "minimized") return null;

  // Resolve the first active slot's block. If no slots are active (the user
  // benched all 3 — a valid intentional state), the widget has nothing to
  // show, so render nothing rather than fall back to legacy state.
  const firstActiveId = activeSlotIds[0];
  if (!firstActiveId) return null;
  const current = blocks.find((b) => b.s2dItemId === firstActiveId);
  if (!current) return null;
  const it = itemMap.get(current.s2dItemId);
  if (!it) return null;

  const totalMs = current.durationMin * 60_000;
  const elapsedMs = blockLiveElapsedMs(current, paused);
  const remainingMs = Math.max(0, totalMs - elapsedMs);
  const overrunMs = elapsedMs > totalMs ? elapsedMs - totalMs : 0;
  const pct = Math.min(100, (elapsedMs / totalMs) * 100);
  const pendingCount = blocks.filter(
    (b) => b.status !== "done" && b.status !== "skipped"
  ).length;
  const activeCount = activeSlotIds.length;

  return (
    <div ref={widgetRef} className="fixed bottom-4 right-4 z-widget w-80 overflow-hidden rounded-lg border border-border bg-card shadow-2xl">
      <div className="relative h-1 w-full bg-secondary">
        <div
          className={cn(
            "absolute inset-y-0 left-0 transition-all",
            overrunMs > 0 ? "bg-destructive" : "bg-primary"
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="p-3">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
          <span className="font-mono">MASH-{it.ticket_number}</span>
          {activeCount > 1 && (
            <span className="rounded bg-primary/15 px-1 py-0.5 font-mono text-primary">
              {activeCount} active
            </span>
          )}
          <span className="ml-auto font-mono">
            {blocks.length - pendingCount}/{blocks.length}
          </span>
        </div>
        <div className="mt-1 line-clamp-2 text-[12px] text-foreground/90">{it.title}</div>
        <div className="mt-2 flex items-center justify-between">
          <div
            className={cn(
              "font-mono text-xl font-semibold tabular-nums",
              overrunMs > 0 ? "text-destructive" : "text-foreground"
            )}
          >
            {overrunMs > 0 ? `+${fmtMs(overrunMs)}` : fmtMs(remainingMs)}
          </div>
          <div className="flex items-center gap-0.5">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => completeBlock(current.s2dItemId, "done")}
              aria-label="Done"
              className="mashi-icon-glow h-6 w-6 rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              title="Done"
            >
              <Check className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={paused ? resume : pause}
              aria-label={paused ? "Resume" : "Pause"}
              className="mashi-icon-glow h-6 w-6 rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              title={paused ? "Resume" : "Pause"}
            >
              {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={unminimize}
              aria-label="Open"
              className="mashi-icon-glow h-6 w-6 rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              title="Open"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => {
                if (confirm("Exit sprint?")) exitSprint();
              }}
              aria-label="Exit"
              className="mashi-icon-glow h-6 w-6 rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-destructive"
              title="Exit"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
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
