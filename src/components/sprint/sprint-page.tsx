"use client";

import { useEffect, useRef } from "react";
import { useSprintStore } from "@/store/sprint-store";
// PlannerPrioritizeShell wraps both Card (swipe deck) and List views
// with a toggle. Both views read the same source data via the shell
// and switch via localStorage persistence.
import { PlannerPrioritizeShell } from "./planner-prioritize-shell";
import { PlannerSchedule } from "./planner-schedule";
import { PlannerReview } from "./planner-review";
import { SprintActiveMode } from "./sprint-active-mode";
import { SprintComplete } from "./sprint-complete";
import { Button } from "@/components/ui/button";
import { Sparkles, Play } from "lucide-react";
import { useGSAP } from "@gsap/react";
import { heroEntry, gsap, EASE, DUR } from "@/lib/animation";

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
  const activeIndex = useSprintStore((s) => s.activeIndex);

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
    return <IdleSplash onStart={enterPlanner} />;
  }

  if (phase === "prioritize" || phase === "schedule" || phase === "review") {
    return (
      <div ref={stageWrapRef} className="flex h-full flex-1 flex-col min-h-0">
        {phase === "prioritize" && <PlannerPrioritizeShell />}
        {phase === "schedule" && <PlannerSchedule />}
        {phase === "review" && <PlannerReview />}
      </div>
    );
  }

  if (phase === "active" || phase === "minimized") {
    // Sprint complete: activeIndex past the end of blocks[]
    if (activeIndex >= blocks.length) return <SprintComplete />;
    return <SprintActiveMode />;
  }

  return null;
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
      <div className="max-w-md space-y-4 text-center">
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
