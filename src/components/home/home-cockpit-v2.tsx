"use client";

// translucency-audit-ok: file — composed of audited primitives; the few
// inline bg-card/N hits below are sanctioned scale steps.

/**
 * Cockpit v2 — the Activity Watcher era layout.
 *
 * Four sections, per PRD §10:
 *   1. Search
 *   2. This week so far (light gamification)
 *   3. Active items
 *   4. Inbox needs attention
 *
 * Plus a "Pending suggestions" surface that sits between sections 3 and 4
 * when non-empty (hidden otherwise).
 *
 * Gated by the `activity_watcher` feature flag. While the flag is off, the
 * legacy 9-tile cockpit in home-cockpit.tsx renders instead.
 *
 * Phase-1 caveats:
 *   - This week numbers are real (from s2d_items.done_at).
 *   - Active items are real (status='in_progress').
 *   - Pending suggestions hit the real /api/activity/suggestions endpoint.
 *   - Inbox is a placeholder for now — wiring it requires hooking into the
 *     existing triage signals, which is a P6 task. Showing a clean empty
 *     state until then.
 */

import { useMemo } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Circle, Clock, Inbox, Sparkles } from "lucide-react";
import { useS2DItems } from "@/hooks/use-s2d";
import { Button } from "@/components/ui/button";
import { SpotlightTrigger } from "@/components/spotlight/spotlight-trigger";
import { PendingSuggestions } from "@/components/activity/pending-suggestions";
import type { S2DItem } from "@/types";

function isThisWeek(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  // Monday-start week.
  const day = now.getDay(); // 0=Sun, 1=Mon, ...
  const daysSinceMonday = (day + 6) % 7;
  const startOfWeek = new Date(now);
  startOfWeek.setHours(0, 0, 0, 0);
  startOfWeek.setDate(now.getDate() - daysSinceMonday);
  return d.getTime() >= startOfWeek.getTime();
}

function isLastWeek(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  const day = now.getDay();
  const daysSinceMonday = (day + 6) % 7;
  const startOfWeek = new Date(now);
  startOfWeek.setHours(0, 0, 0, 0);
  startOfWeek.setDate(now.getDate() - daysSinceMonday);
  const startOfLastWeek = new Date(startOfWeek);
  startOfLastWeek.setDate(startOfWeek.getDate() - 7);
  return (
    d.getTime() >= startOfLastWeek.getTime() && d.getTime() < startOfWeek.getTime()
  );
}

export function HomeCockpitV2() {
  const { data: items = [], isLoading } = useS2DItems();

  const { weekDone, lastWeekDone, weekInProgress, activeItems } = useMemo(() => {
    const weekDoneItems: S2DItem[] = [];
    const lastWeekDoneItems: S2DItem[] = [];
    const inProgress: S2DItem[] = [];
    for (const it of items) {
      if (it.status === "in_progress") inProgress.push(it);
      if (it.done_at && isThisWeek(it.done_at)) weekDoneItems.push(it);
      if (it.done_at && isLastWeek(it.done_at)) lastWeekDoneItems.push(it);
    }
    return {
      weekDone: weekDoneItems,
      lastWeekDone: lastWeekDoneItems,
      weekInProgress: inProgress.length,
      activeItems: inProgress
        .sort(
          (a, b) =>
            new Date(b.updated_at ?? 0).getTime() -
            new Date(a.updated_at ?? 0).getTime()
        )
        .slice(0, 6),
    };
  }, [items]);

  const weekDelta = weekDone.length - lastWeekDone.length;
  const trendLabel =
    weekDelta > 0
      ? `Ahead of last week by ${weekDelta}`
      : weekDelta < 0
        ? `Behind last week by ${Math.abs(weekDelta)}`
        : "Matching last week's pace";

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 px-4 pb-4 pt-3">
      {/* SECTION 1 — Search */}
      <Section title="Search">
        <SpotlightTrigger />
      </Section>

      {/* SECTION 2 — This week so far */}
      <Section title="This week so far">
        <WeekSummary
          done={weekDone.length}
          inProgress={weekInProgress}
          trendLabel={trendLabel}
          delta={weekDelta}
        />
      </Section>

      {/* SECTION 3 — Active items */}
      <Section
        title="Active items"
        action={
          <Link
            href="/s2d"
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            All items <ArrowRight className="h-3 w-3" />
          </Link>
        }
      >
        <ActiveItemsList items={activeItems} loading={isLoading} />
      </Section>

      {/* PENDING SUGGESTIONS — hidden when empty */}
      <PendingSuggestions />

      {/* SECTION 4 — Inbox */}
      <Section title="Inbox needs attention">
        <InboxPlaceholder />
      </Section>
    </div>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function WeekSummary({
  done,
  inProgress,
  trendLabel,
  delta,
}: {
  done: number;
  inProgress: number;
  trendLabel: string;
  delta: number;
}) {
  // Wordle-grid: 5 weekdays × N tiles. One tile per completed item this week.
  const tiles = Array.from({ length: Math.max(done, 5) }, (_, i) => (
    <div
      key={i}
      className={
        i < done
          ? "h-6 w-6 rounded-sm bg-primary/80 transition-colors"
          : "h-6 w-6 rounded-sm border border-border/40 bg-card/60"
      }
    />
  ));

  return (
    <div className="rounded-lg border bg-card/60 p-3">
      <div className="flex items-baseline gap-6">
        <Stat value={done} label="Completed" />
        <Stat value={inProgress} label="In Progress" />
        <div className="ml-auto flex flex-col items-end">
          <span
            className={
              delta > 0
                ? "text-xs font-medium text-primary"
                : delta < 0
                  ? "text-xs font-medium text-muted-foreground"
                  : "text-xs font-medium text-muted-foreground"
            }
          >
            {trendLabel}
          </span>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">{tiles}</div>
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xl font-semibold tabular-nums">{value}</span>
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
    </div>
  );
}

function ActiveItemsList({
  items,
  loading,
}: {
  items: S2DItem[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="rounded-lg border bg-card/60 p-3 text-xs text-muted-foreground">
        Loading…
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="rounded-lg border bg-card/60 p-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5" />
          Nothing in progress. Pick something from the board to get started.
        </div>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-1.5">
      {items.map((it) => (
        <Link
          key={it.id}
          href={`/s2d?item=${it.id}`}
          className="group flex items-center gap-2 rounded-md border bg-card/60 px-3 py-2 mashi-magnetic"
        >
          <Circle className="h-3.5 w-3.5 text-primary" />
          <span className="flex-1 truncate text-sm">{it.title}</span>
          {it.updated_at && (
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
              <Clock className="h-3 w-3" />
              {relativeTime(it.updated_at)}
            </span>
          )}
        </Link>
      ))}
    </div>
  );
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function InboxPlaceholder() {
  return (
    <div className="rounded-lg border bg-card/60 p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Inbox className="h-3.5 w-3.5" />
        Triage-flagged messages will appear here. (Wiring up in P6.)
      </div>
      <div className="mt-2">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/inbox">
            Open inbox <ArrowRight className="ml-1 h-3 w-3" />
          </Link>
        </Button>
      </div>
    </div>
  );
}

// Keep these imports referenced even if a future iteration drops them.
void CheckCircle2;
