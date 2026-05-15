"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useS2DItems } from "@/hooks/use-s2d";
import { useSprintStore, liveElapsedMs } from "@/store/sprint-store";
import { Maximize2, Check, Pause, Play, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useGSAP } from "@gsap/react";
import { slideUp } from "@/lib/animation";

/**
 * Sticky floating widget for minimized sprint state. Shows current task +
 * countdown. Click maximize to re-enter the full takeover.
 */
export function SprintWidget() {
  const phase = useSprintStore((s) => s.phase);
  const blocks = useSprintStore((s) => s.blocks);
  const activeIndex = useSprintStore((s) => s.activeIndex);
  const paused = useSprintStore((s) => s.paused);
  const blockStartedAtMs = useSprintStore((s) => s.blockStartedAtMs);
  const blockElapsedMsAccum = useSprintStore((s) => s.blockElapsedMsAccum);
  const unminimize = useSprintStore((s) => s.unminimize);
  const advance = useSprintStore((s) => s.advance);
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
  if (activeIndex >= blocks.length) return null;

  const current = blocks[activeIndex];
  const it = itemMap.get(current.s2dItemId);
  if (!it) return null;

  const totalMs = current.durationMin * 60_000;
  const elapsedMs = liveElapsedMs({ blockStartedAtMs, blockElapsedMsAccum, paused });
  const remainingMs = Math.max(0, totalMs - elapsedMs);
  const overrunMs = elapsedMs > totalMs ? elapsedMs - totalMs : 0;
  const pct = Math.min(100, (elapsedMs / totalMs) * 100);

  return (
    <div ref={widgetRef} className="fixed bottom-4 right-4 z-[90] w-80 overflow-hidden rounded-lg border border-border bg-card shadow-2xl">
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
          <span className="ml-auto font-mono">
            {activeIndex + 1}/{blocks.length}
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
            <button
              onClick={() => advance("done")}
              className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              title="Done"
            >
              <Check className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={paused ? resume : pause}
              className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              title={paused ? "Resume" : "Pause"}
            >
              {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
            </button>
            <button
              onClick={unminimize}
              className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              title="Open"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => {
                if (confirm("Exit sprint?")) exitSprint();
              }}
              className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-destructive"
              title="Exit"
            >
              <X className="h-3.5 w-3.5" />
            </button>
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
