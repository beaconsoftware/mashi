"use client";

import { useEffect, useState } from "react";

/**
 * Re-render the calling component every `intervalMs`. Use only in leaf
 * components that display live-updating values (elapsed timers, "Xs
 * ago" relative times). Do NOT mount this on parent components — every
 * tick re-renders the entire subtree, which is what made typing in the
 * Focus card chat composer feel sluggish.
 *
 * The hook bails when `enabled` is false so paused sprints / off-screen
 * timers don't waste cycles.
 */
export function useTick(intervalMs: number, enabled: boolean = true): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, enabled]);
  return tick;
}
