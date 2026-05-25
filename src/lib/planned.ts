import type { S2DItem } from "@/types";

/**
 * "Today" / "Overdue" tag logic — all date math lives here so the card
 * chrome, sprint planner, and daily recap all derive the same way.
 *
 * The badge state is purely computed: it's NEVER stored. `planned_for`
 * is the only persisted field; rendering decides what to show.
 *
 * Day boundaries use the BROWSER's local calendar day (toISOString slice
 * after offsetting for the tz). The user's "today" is whatever calendar
 * day they're looking at the screen on, not UTC midnight. This means a
 * user in Tokyo and a user in NYC see the same item flip from "Today" to
 * "Overdue" at their own midnight, which is what they expect.
 *
 *   - planned_for = today AND not done → "today"
 *   - planned_for = yesterday AND not done → "overdue"
 *   - planned_for older than yesterday → null (data stays for analytics)
 *   - status = "done" → null (shipped trumps planning state)
 *   - planned_for null → null
 */

export type PlannedState = "today" | "overdue" | null;

/**
 * Browser-local YYYY-MM-DD for the current calendar day.
 * Pure helper so unit tests can stub it (or the daily-recap server job
 * can pass an explicit "now" if it needs to backdate a report).
 */
export function todayIso(now: Date = new Date()): string {
  const tzOffsetMs = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - tzOffsetMs).toISOString().slice(0, 10);
}

/**
 * YYYY-MM-DD for N days before today (browser-local).
 */
export function daysAgoIso(n: number, now: Date = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() - n);
  return todayIso(d);
}

/**
 * Compute the visible planned-state for an item right now.
 * Returns null when no badge should render.
 */
export function getPlannedState(
  item: Pick<S2DItem, "planned_for" | "status">,
  now: Date = new Date()
): PlannedState {
  if (!item.planned_for) return null;
  if (item.status === "done") return null;
  const today = todayIso(now);
  const yesterday = daysAgoIso(1, now);
  if (item.planned_for === today) return "today";
  if (item.planned_for === yesterday) return "overdue";
  return null;
}
