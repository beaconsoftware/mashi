"use client";

import { useEffect, useRef } from "react";
import { useSprintStore } from "@/store/sprint-store";
// PlannerPrioritizeShell wraps both Card (swipe deck) and List views
// with a toggle. Both views read the same source data via the shell
// and switch via localStorage persistence.
import { PlannerPrioritizeShell } from "./planner-prioritize-shell";
import { PlannerSchedule } from "./planner-schedule";
import { PlannerReview } from "./planner-review";
// Multi-active is the default sprint experience now (up to 3 items in
// parallel slots with a rolling queue dock). The legacy single-focus
// SprintActiveMode is kept on disk if we ever want a "focus mode" toggle.
import { SprintActiveModeMulti } from "./sprint-active-mode-multi";
import { SprintComplete } from "./sprint-complete";
import { Button } from "@/components/ui/button";
import { Sparkles, Play } from "lucide-react";
import { useGSAP } from "@gsap/react";
import { heroEntry, gsap, EASE, DUR } from "@/lib/animation";
import { TopBar } from "@/components/layout/top-bar";

/**
 * Map of sprint phase -> a short subtitle for the TopBar so the user
 * always sees where they are in the planning flow. Active/minimized
 * is a fixed overlay and renders its own header, so we skip TopBar
 * there to avoid double-stacking.
 */
const SPRINT_SUBTITLE: Record<string, string> = {
  idle: "Plan your next focus block.",
  prioritize: "Stage 1 of 3 — pick + order the items you'll work on.",
  schedule: "Stage 2 of 3 — assign durations + slot positions.",
  review: "Stage 3 of 3 — lock in the plan.",
};

/**
 * Top-level /sprint route. Switches what's rendered based on the store's
 * `phase`. Idle → "Plan a sprint" landing. Planning phases route to the
 * three planner stages. Active/minimized hands off to the focus-mode UI
 * (which can also be triggered from anywhere via the global mount).
 */
export function SprintPage() {
  const phase = useSprintStore((s) => s.phase);
  const enterPlanner = useSprintStore((s) => s.enterPlanner);
  const blocks = useSprintStore((s) => s.blocks);
  // activeIndex (legacy serial cursor) no longer consumed here — the
  // multi-active mode derives completion from per-block status.

  // If user hits /sprint while a sprint is minimized, surface the full UI
  useEffect(() => {
    if (phase === "minimized") {
      useSprintStore.setState({ phase: "active" });
    }
  }, [phase]);

  // Cross-fade between planner stages so the multi-step flow feels like
  // one continuous motion rather than navigating between pages.
  const stageWrapRef = useRef<HTMLDivElement | null>(null);
  useGSAP(
    () => {
      if (!stageWrapRef.current) return;
      gsap.fromTo(
        stageWrapRef.current,
        { opacity: 0, y: 8 },
        { opacity: 1, y: 0, duration: DUR.base, ease: EASE.out, clearProps: "all" }
      );
    },
    { dependencies: [phase] }
  );

  if (phase === "idle") {
    return (
      <>
        <TopBar title="Sprint" subtitle={SPRINT_SUBTITLE.idle} />
        <IdleSplash onStart={enterPlanner} />
      </>
    );
  }

  if (phase === "prioritize" || phase === "schedule" || phase === "review") {
    return (
      <>
        <TopBar title="Sprint" subtitle={SPRINT_SUBTITLE[phase]} />
        <div ref={stageWrapRef} className="flex h-full flex-1 flex-col min-h-0">
          {phase === "prioritize" && <PlannerPrioritizeShell />}
          {phase === "schedule" && <PlannerSchedule />}
          {phase === "review" && <PlannerReview />}
        </div>
      </>
    );
  }

  if (phase === "active") {
    // Sprint complete check, multi-active aware: every block has settled
    // (status done/skipped). Empty blocks → also "complete" (nothing to
    // do; the SprintComplete screen handles that no-ops gracefully).
    const allSettled =
      blocks.length === 0 ||
      blocks.every((b) => b.status === "done" || b.status === "skipped");
    // Active mode is a fullscreen overlay (sprint-active-mode-multi)
    // so we deliberately skip <TopBar /> here — the overlay covers
    // the dashboard's top row anyway.
    if (allSettled) return <SprintComplete />;
    return <SprintActiveModeMulti />;
  }

  if (phase === "minimized") {
    // The fullscreen overlay is dismissed; the global SprintWidget (in
    // AppShell's SprintGlobalMount) floats over every page including
    // this one. We render a quiet placeholder so /sprint isn't empty.
    return (
      <>
        <TopBar title="Sprint" subtitle="Running in the background." />
        <MinimizedSplash />
      </>
    );
  }

  return null;
}

function MinimizedSplash() {
  const unminimize = useSprintStore((s) => s.unminimize);
  return (
    <div className="flex h-full flex-1 items-center justify-center p-8">
      {/* Backdrop-blurred card so the copy stays legible against the
          ambient album-art layer when Spotify is playing during a
          minimized sprint. */}
      <div className="max-w-md space-y-4 rounded-2xl border border-border/40 bg-background/60 px-8 py-8 text-center backdrop-blur-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-secondary">
          <Sparkles className="h-5 w-5 text-muted-foreground" />
        </div>
        <h1 className="text-xl font-semibold tracking-tight">Sprint minimized</h1>
        <p className="text-sm text-muted-foreground">
          Your sprint is running in the background. Open the floating widget or
          tap below to bring it back full-screen.
        </p>
        <Button onClick={unminimize} className="gap-1.5">
          <Play className="h-3.5 w-3.5" />
          Resume full-screen
        </Button>
      </div>
    </div>
  );
}

function IdleSplash({ onStart }: { onStart: () => void }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const sparkleRef = useRef<HTMLDivElement | null>(null);
  useGSAP(
    () => {
      if (rootRef.current) heroEntry(rootRef.current);
      if (sparkleRef.current) {
        gsap.fromTo(
          sparkleRef.current,
          { rotate: -180, scale: 0 },
          { rotate: 0, scale: 1, duration: 0.8, ease: EASE.elastic, delay: 0.1 }
        );
      }
    },
    { scope: rootRef }
  );

  return (
    <div ref={rootRef} className="flex h-full flex-1 items-center justify-center p-8">
      {/* Backdrop-blurred card mirrors the empty-state pattern from
          <EmptyState> — the splash sits over the ambient album-art layer
          and needs its own opaque surface to read. */}
      <div className="max-w-md space-y-4 rounded-2xl border border-border/40 bg-background/60 px-8 py-8 text-center backdrop-blur-sm">
        <div ref={sparkleRef} className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/15">
          <Sparkles className="h-5 w-5 text-primary" />
        </div>
        <h1 className="text-xl font-semibold tracking-tight">Plan a sprint</h1>
        <p className="text-sm text-muted-foreground">
          Pick what you&apos;ll work on, block out times, and Mashi will hold you to it
          with a focus timer and matching calendar invites.
        </p>
        <Button size="lg" onClick={onStart} className="gap-2">
          <Play className="h-4 w-4" />
          Start planning
        </Button>
      </div>
    </div>
  );
}
