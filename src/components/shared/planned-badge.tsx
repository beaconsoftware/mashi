"use client";

import { Sun, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { S2DItem } from "@/types";
import { getPlannedState } from "@/lib/planned";

/**
 * Visible-only badge for the daily-planning "Today" tag. Renders nothing
 * when the item isn't planned, was planned before yesterday, or is done.
 * All the date math lives in `@/lib/planned` so the card, planner, and
 * recap all agree.
 *
 * Two states:
 *   - today    → calm primary chip with a sun glyph. Says "this is on
 *                deck for today" without shouting.
 *   - overdue  → amber chip with an alert glyph. Visibly different from
 *                Today but not aggressive — the user has another 24h
 *                to land it before the badge ages out entirely.
 */
export function PlannedBadge({
  item,
  className,
}: {
  item: Pick<S2DItem, "planned_for" | "status">;
  className?: string;
}) {
  const state = getPlannedState(item);
  if (!state) return null;

  if (state === "today") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded border border-primary/40 bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary",
          className
        )}
        title="Planned for today"
      >
        <Sun aria-hidden className="h-2.5 w-2.5" />
        <span>Today</span>
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-400",
        className
      )}
      title="Was planned for yesterday and not finished. You have 24h to land it before the badge ages out."
    >
      <AlertCircle aria-hidden className="h-2.5 w-2.5" />
      <span>Overdue</span>
    </span>
  );
}
