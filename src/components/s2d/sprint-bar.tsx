"use client";

import { Zap, Timer, TrendingUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useS2DItems } from "@/hooks/use-s2d";
import { useSprintStore } from "@/store/sprint-store";

export function SprintBar() {
  const { data: items = [] } = useS2DItems();
  const todo = items.filter((i) => i.status === "todo").length;
  const inProgress = items.filter((i) => i.status === "in_progress").length;
  const doneToday = items.filter(
    (i) => i.status === "done" && i.done_at && isToday(i.done_at)
  ).length;
  const inQueue = items.filter((i) => i.status === "in_queue").length;

  const router = useRouter();
  const enterPlanner = useSprintStore((s) => s.enterPlanner);
  const sprintPhase = useSprintStore((s) => s.phase);

  // Route to the dedicated planner at /sprint. If a sprint is in progress
  // (active/minimized), button takes the user back to it instead of
  // wiping state — full-screen mode re-engages on entry.
  function planSprint() {
    if (sprintPhase === "active" || sprintPhase === "minimized") {
      router.push("/sprint");
      return;
    }
    enterPlanner();
    router.push("/sprint");
  }

  const sprintLive = sprintPhase === "active" || sprintPhase === "minimized";

  return (
    <div className="flex items-center gap-4 border-b border-border/40 bg-secondary/20 px-4 py-2 text-[11px]">
      <Stat label="todo" value={todo} accent />
      <Stat label="in flight" value={inProgress} />
      <Stat label="waiting" value={inQueue} />
      <Stat label="done · today" value={doneToday} />

      <div className="ml-auto flex items-center gap-3">
        <div className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
          <TrendingUp className="h-3 w-3" />
          velocity <span className="text-foreground/80">{Math.round(velocityScore(items) * 100)}%</span>
        </div>
        <div className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
          <Timer className="h-3 w-3" />
          {timeOfDayLabel()}
        </div>
        <Button
          size="sm"
          onClick={planSprint}
          className="h-7 gap-1.5"
          title={sprintLive ? "Return to active sprint" : "Open the sprint planner"}
        >
          <Zap className={`h-3.5 w-3.5 ${sprintLive ? "animate-pulse" : ""}`} />
          {sprintLive ? "Sprint in progress" : "Plan sprint"}
        </Button>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span
        className={
          accent
            ? "font-mono text-base font-medium text-primary"
            : "font-mono text-base font-medium text-foreground/85"
        }
      >
        {value}
      </span>
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
    </div>
  );
}

function isToday(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function velocityScore(items: Array<{ status: string; done_at?: string | null }>): number {
  const completed = items.filter((i) => i.status === "done" && i.done_at && isToday(i.done_at)).length;
  const opened = items.filter((i) => i.status === "todo" || i.status === "in_progress").length;
  if (opened === 0 && completed === 0) return 0;
  return Math.min(1, completed / Math.max(1, completed + opened));
}

function timeOfDayLabel(): string {
  const h = new Date().getHours();
  if (h < 10) return "morning sprint";
  if (h < 13) return "midday sprint";
  if (h < 17) return "afternoon sprint";
  return "EOD wrap";
}
