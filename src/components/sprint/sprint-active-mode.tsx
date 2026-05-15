"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useS2DItems, useUpdateS2DItem } from "@/hooks/use-s2d";
import { useSprintStore, liveElapsedMs } from "@/store/sprint-store";
import { useGSAP } from "@gsap/react";
import { heroEntry, pulse, gsap, EASE, DUR } from "@/lib/animation";
import { Button } from "@/components/ui/button";
import {
  Check,
  Pause,
  Play,
  SkipForward,
  Minimize2,
  X,
  MessageSquare,
  BellOff,
} from "lucide-react";
import { useS2DStore } from "@/store/s2d-store";
import { PathwayBadge } from "@/components/shared/pathway-badge";
import { PriorityDot } from "@/components/shared/priority-dot";
import { cn } from "@/lib/utils";

/**
 * Full-screen focus mode. Renders as a fixed overlay above everything else.
 *
 * Layout:
 *   - Center stage: big current-task title, MASH-N, countdown timer
 *   - Right rail: queue of next 2-3 items
 *   - Footer: action buttons + keyboard shortcuts hint
 *   - Top: progress bar across the whole sprint
 *
 * Keyboard:
 *   ↵ done · → skip · z snooze · space pause · m minimize · esc exit
 */
export function SprintActiveMode() {
  const blocks = useSprintStore((s) => s.blocks);
  const activeIndex = useSprintStore((s) => s.activeIndex);
  const paused = useSprintStore((s) => s.paused);
  const blockStartedAtMs = useSprintStore((s) => s.blockStartedAtMs);
  const blockElapsedMsAccum = useSprintStore((s) => s.blockElapsedMsAccum);
  const advance = useSprintStore((s) => s.advance);
  const pause = useSprintStore((s) => s.pause);
  const resume = useSprintStore((s) => s.resume);
  const minimize = useSprintStore((s) => s.minimize);
  const exitSprint = useSprintStore((s) => s.exitSprint);
  const phase = useSprintStore((s) => s.phase);

  const updateItem = useUpdateS2DItem();
  const { data: items } = useS2DItems();
  const setSelected = useS2DStore((s) => s.setSelectedItem);

  // Tick to drive the live timer
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

  const current = blocks[activeIndex];
  const currentItem = current ? itemMap.get(current.s2dItemId) : null;
  const totalMs = (current?.durationMin ?? 30) * 60_000;
  const elapsedMs = liveElapsedMs({ blockStartedAtMs, blockElapsedMsAccum, paused });
  const remainingMs = Math.max(0, totalMs - elapsedMs);
  const overrunMs = elapsedMs > totalMs ? elapsedMs - totalMs : 0;

  const overallTotalMs = blocks.reduce((sum, b) => sum + b.durationMin * 60_000, 0);
  const completedMs = blocks
    .slice(0, activeIndex)
    .reduce((sum, b) => sum + b.durationMin * 60_000, 0);
  const overallPct = overallTotalMs
    ? ((completedMs + Math.min(elapsedMs, totalMs)) / overallTotalMs) * 100
    : 0;

  // Mark current item in_progress on entry
  useEffect(() => {
    if (!currentItem || currentItem.status === "in_progress") return;
    updateItem.mutate({ id: currentItem.id, patch: { status: "in_progress" } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentItem?.id]);

  function markDoneAndAdvance() {
    if (currentItem) {
      updateItem.mutate({
        id: currentItem.id,
        patch: { status: "done", outcome: "Completed in sprint", resolved_via: "manual" },
      });
    }
    advance("done");
  }
  function skip() {
    if (currentItem) {
      updateItem.mutate({
        id: currentItem.id,
        patch: { status: "todo" }, // back to todo, not done
      });
    }
    advance("skipped");
  }
  function snooze() {
    if (currentItem) {
      const t = new Date();
      t.setHours(t.getHours() + 4);
      updateItem.mutate({
        id: currentItem.id,
        patch: {
          status: "in_queue",
          snoozed_until: t.toISOString(),
          queue_reason: "Snoozed mid-sprint",
        },
      });
    }
    advance("skipped");
  }

  // Keyboard shortcuts (active phase only — minimized state shouldn't capture)
  useEffect(() => {
    if (phase !== "active") return;
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName ?? "";
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "Enter") {
        e.preventDefault();
        markDoneAndAdvance();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        skip();
      } else if (e.key.toLowerCase() === "z") {
        snooze();
      } else if (e.key === " ") {
        e.preventDefault();
        paused ? resume() : pause();
      } else if (e.key.toLowerCase() === "m") {
        minimize();
      } else if (e.key === "Escape") {
        minimize();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, paused, currentItem?.id]);

  // Refs for animation
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<HTMLDivElement | null>(null);
  const upNextRef = useRef<HTMLDivElement | null>(null);

  // Hero entry when overlay first appears
  useGSAP(
    () => {
      if (phase !== "active" || !overlayRef.current) return;
      const tl = gsap.timeline();
      tl.from(overlayRef.current, {
        opacity: 0,
        duration: DUR.short,
        ease: EASE.out,
      });
      if (stageRef.current) {
        tl.from(
          stageRef.current,
          {
            opacity: 0,
            scale: 0.95,
            duration: DUR.hero,
            ease: EASE.back,
            clearProps: "all",
          },
          "<+0.05"
        );
      }
      if (upNextRef.current) {
        tl.from(
          upNextRef.current.children,
          {
            opacity: 0,
            x: 24,
            duration: DUR.base,
            stagger: 0.08,
            ease: EASE.out,
            clearProps: "all",
          },
          "<+0.1"
        );
      }
    },
    { dependencies: [phase] }
  );

  // Block transition: slide the stage when activeIndex changes mid-sprint
  const prevIndexRef = useRef(activeIndex);
  useGSAP(
    () => {
      if (phase !== "active" || !stageRef.current) return;
      if (activeIndex === prevIndexRef.current) return;
      const dir = activeIndex > prevIndexRef.current ? 1 : -1;
      prevIndexRef.current = activeIndex;
      gsap.fromTo(
        stageRef.current,
        { x: 80 * dir, opacity: 0 },
        {
          x: 0,
          opacity: 1,
          duration: DUR.base,
          ease: EASE.out,
          clearProps: "x",
        }
      );
    },
    { dependencies: [activeIndex] }
  );

  // Timer pulse when overrun
  useGSAP(
    () => {
      if (!timerRef.current) return;
      if (overrunMs > 0) {
        const tween = pulse(timerRef.current);
        return () => tween.kill();
      }
    },
    { dependencies: [overrunMs > 0] }
  );

  if (!current || !currentItem) return null;
  if (phase !== "active") return null;

  const upNext = blocks.slice(activeIndex + 1, activeIndex + 4);

  return (
    <div ref={overlayRef} className="fixed inset-0 z-[100] flex flex-col bg-background">
      {/* Progress bar */}
      <div className="h-1 w-full bg-secondary/40">
        <div
          className="h-full bg-primary transition-all duration-700"
          style={{ width: `${overallPct}%` }}
        />
      </div>

      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-border/30 px-6 py-3">
        <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
          Block {activeIndex + 1} of {blocks.length} · Sprint {Math.round(overallPct)}%
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={minimize} className="gap-1.5">
            <Minimize2 className="h-3.5 w-3.5" />
            Minimize
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (confirm("Exit sprint? Progress on the current block won't be saved.")) {
                exitSprint();
              }
            }}
            className="gap-1.5 text-muted-foreground hover:text-destructive"
          >
            <X className="h-3.5 w-3.5" />
            Exit
          </Button>
        </div>
      </div>

      <div className="grid flex-1 grid-cols-1 gap-6 p-8 md:grid-cols-[1fr_320px]">
        {/* Center stage */}
        <div ref={stageRef} className="flex flex-col items-center justify-center text-center">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
            <PriorityDot priority={currentItem.priority} />
            <PathwayBadge pathway={currentItem.pathway} />
            <span className="font-mono">MASH-{currentItem.ticket_number}</span>
          </div>
          <h1 className="mt-4 max-w-3xl text-balance text-3xl font-semibold leading-tight tracking-tight">
            {currentItem.title}
          </h1>

          <div
            ref={timerRef}
            className={cn(
              "mt-10 font-mono text-7xl font-bold tabular-nums tracking-tight",
              overrunMs > 0 ? "text-destructive" : paused ? "text-muted-foreground" : "text-foreground"
            )}
          >
            {overrunMs > 0 ? `+${fmtMs(overrunMs)}` : fmtMs(remainingMs)}
          </div>
          <div className="mt-1 text-[12px] text-muted-foreground">
            {overrunMs > 0
              ? "over plan — wrap it up or extend"
              : paused
              ? "paused"
              : `of ${current.durationMin}m planned`}
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
            <Button size="lg" onClick={markDoneAndAdvance} className="gap-2">
              <Check className="h-4 w-4" />
              Done <span className="ml-2 font-mono text-[10px] opacity-60">↵</span>
            </Button>
            <Button variant="outline" size="lg" onClick={paused ? resume : pause} className="gap-2">
              {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
              {paused ? "Resume" : "Pause"}
              <span className="ml-2 font-mono text-[10px] opacity-60">space</span>
            </Button>
            <Button variant="outline" size="lg" onClick={skip} className="gap-2">
              <SkipForward className="h-4 w-4" />
              Skip <span className="ml-2 font-mono text-[10px] opacity-60">→</span>
            </Button>
            <Button variant="ghost" size="lg" onClick={snooze} className="gap-2 text-muted-foreground">
              <BellOff className="h-4 w-4" />
              Snooze <span className="ml-2 font-mono text-[10px] opacity-60">z</span>
            </Button>
          </div>

          <div className="mt-6 flex items-center gap-3 text-[11px] text-muted-foreground">
            <button
              onClick={() => setSelected(currentItem.id)}
              className="inline-flex items-center gap-1 hover:text-foreground"
            >
              <MessageSquare className="h-3 w-3" />
              Open detail / talk to Mashi
            </button>
          </div>
        </div>

        {/* Right rail: up next */}
        <div ref={upNextRef} className="flex flex-col gap-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Up next
          </div>
          {upNext.length === 0 ? (
            <div className="rounded-md border border-border/30 bg-card p-3 text-[12px] text-muted-foreground">
              Last block — finish strong.
            </div>
          ) : (
            upNext.map((b, i) => {
              const it = itemMap.get(b.s2dItemId);
              if (!it) return null;
              const start = new Date(b.startAt);
              return (
                <div
                  key={b.s2dItemId}
                  className="rounded-md border border-border/30 bg-card/60 p-3"
                  style={{ opacity: 1 - i * 0.2 }}
                >
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <span className="font-mono">MASH-{it.ticket_number}</span>
                    <PriorityDot priority={it.priority} />
                    <span className="ml-auto font-mono">
                      {start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} ·{" "}
                      {b.durationMin}m
                    </span>
                  </div>
                  <div className="mt-1 line-clamp-2 text-[12px] text-foreground/85">
                    {it.title}
                  </div>
                </div>
              );
            })
          )}
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
