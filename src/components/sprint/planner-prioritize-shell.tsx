"use client";

/**
 * Wrapper that lets the user pick between Card (swipe deck) and List
 * (compact multi-select) views for sprint planning. The preference is
 * persisted in localStorage so each user lands in whichever view they
 * prefer next time.
 *
 * Both views read from the same TanStack source and shared
 * useEligibleItems() helper, so swapping between them is just a
 * presentation change — no data refetch.
 *
 * Also handles loading + empty-state UI uniformly so a flicker between
 * "Loading…" and "Deck cleared" can't happen during the brief window
 * where useS2DItems is fetching but useCompanies hasn't returned yet.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { LayoutGrid, List, Columns3, Sun, AlertCircle } from "lucide-react";
import { useS2DItems } from "@/hooks/use-s2d";
import { useSprintStore } from "@/store/sprint-store";
import { Button } from "@/components/ui/button";
import { ChromeBar } from "@/components/layout/primitives";
import { PlannerPrioritizeSwipe } from "./planner-prioritize-swipe";
import { PlannerPrioritizeList } from "./planner-prioritize-list";
import { PlannerPrioritizeBoard } from "./planner-prioritize-board";
import type { S2DItem } from "@/types";
import { cn } from "@/lib/utils";
import { getPlannedState, todayIso } from "@/lib/planned";

type PlannedFilterValue = "today" | "overdue";

type ViewMode = "card" | "list" | "board";

const VIEW_KEY = "mashi:sprint-planner-view";

function readSavedView(): ViewMode {
  if (typeof window === "undefined") return "card";
  const v = window.localStorage.getItem(VIEW_KEY);
  if (v === "list") return "list";
  if (v === "board") return "board";
  return "card";
}

const PRIORITY_ORDER: Record<string, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/**
 * Shared filter + sort. Decoupled from the views so both render the
 * same items in the same order.
 *
 * Sort order: planned-state first (Today, then Overdue, then unplanned),
 * then priority, then created_at desc. This surfaces what the user
 * already committed to before forcing them to wade through the rest of
 * the backlog — the whole point of the daily-planning flow.
 *
 * IMPORTANT: we DO NOT filter out items where sprint_date === today.
 * Previously we did — that's what caused the "Deck cleared with 150 open
 * items" bug. If the user had already planned a sprint with most items,
 * the filter ate them all and the planner looked empty. Better behavior:
 * include them, mark them "in sprint", and let the user re-confirm.
 */
const PLANNED_WEIGHT: Record<NonNullable<ReturnType<typeof getPlannedState>> | "none", number> = {
  today: 0,
  overdue: 1,
  none: 2,
};

export function eligibleForSprint(items: S2DItem[]): S2DItem[] {
  const eligible = items.filter((it) => it.status !== "done");
  eligible.sort((a, b) => {
    const pwa = PLANNED_WEIGHT[getPlannedState(a) ?? "none"];
    const pwb = PLANNED_WEIGHT[getPlannedState(b) ?? "none"];
    if (pwa !== pwb) return pwa - pwb;
    const pa = PRIORITY_ORDER[a.priority] ?? 9;
    const pb = PRIORITY_ORDER[b.priority] ?? 9;
    if (pa !== pb) return pa - pb;
    const ta = new Date(a.created_at).getTime();
    const tb = new Date(b.created_at).getTime();
    return tb - ta;
  });
  return eligible;
}

export function PlannerPrioritizeShell() {
  const { data: items = [], isPending, isError, error } = useS2DItems();
  const exit = useSprintStore((s) => s.exitSprint);
  const selectedItemIds = useSprintStore((s) => s.selectedItemIds);
  const reorderSelected = useSprintStore((s) => s.reorderSelected);

  // Pre-seed the planner's selection from items the user already
  // committed to today on the board. Two signals count:
  //   - sprint_date === today  (set by the board's "Add to sprint"
  //                              bulk action)
  //   - planned_for === today  (set by the board's "Plan for today"
  //                              bulk action)
  //
  // Seed runs ONCE per planner entry, gated by a ref. After the first
  // seed the user owns the selection — clearing it mid-flow shouldn't
  // be undone by this effect. `enterPlanner` wipes selectedItemIds to
  // [] on every fresh entry, which remounts this component, so
  // didSeedRef naturally resets too.
  const didSeedRef = useRef(false);
  useEffect(() => {
    if (didSeedRef.current) return;
    if (isPending || items.length === 0) return;
    // User entered the planner with a non-empty selection (e.g. came
    // back from a later phase). Respect it; don't re-seed over it.
    if (selectedItemIds.length > 0) {
      didSeedRef.current = true;
      return;
    }
    const today = todayIso();
    const seed = items
      .filter(
        (it) =>
          it.status !== "done" &&
          (it.sprint_date === today || it.planned_for === today)
      )
      .map((it) => it.id);
    if (seed.length > 0) reorderSelected(seed);
    didSeedRef.current = true;
  }, [isPending, items, selectedItemIds.length, reorderSelected]);

  const [view, setView] = useState<ViewMode>("card");
  useEffect(() => {
    setView(readSavedView());
  }, []);
  function switchView(next: ViewMode) {
    setView(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(VIEW_KEY, next);
    }
  }

  // Daily-planning filter: when any chip is on, narrow the planner's
  // eligible list to items in that planned state. Empty set = show all
  // eligible items (default). Mirrors the board's Today / Overdue filter.
  const [plannedFilter, setPlannedFilter] = useState<Set<PlannedFilterValue>>(
    () => new Set()
  );
  function togglePlanned(v: PlannedFilterValue) {
    setPlannedFilter((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });
  }

  const eligibleAll = useMemo(() => eligibleForSprint(items), [items]);
  const eligible = useMemo(() => {
    if (plannedFilter.size === 0) return eligibleAll;
    return eligibleAll.filter((it) => {
      const state = getPlannedState(it);
      return !!state && plannedFilter.has(state);
    });
  }, [eligibleAll, plannedFilter]);

  // Count of items in each planned bucket (over all eligible, not the
  // currently-filtered slice) so chip labels can show "Today · 4" type
  // hints when those items exist.
  const plannedCounts = useMemo(() => {
    let today = 0;
    let overdue = 0;
    for (const it of eligibleAll) {
      const state = getPlannedState(it);
      if (state === "today") today += 1;
      else if (state === "overdue") overdue += 1;
    }
    return { today, overdue };
  }, [eligibleAll]);

  // ── Defensive empty-state UI ──────────────────────────────────────
  if (isPending) {
    return (
      <CenterMessage>
        Loading your open items…
      </CenterMessage>
    );
  }

  if (isError) {
    return (
      <CenterMessage>
        <div className="space-y-2">
          <div className="text-destructive">Couldn&apos;t load items.</div>
          <div className="text-[11px] text-muted-foreground">
            {error instanceof Error ? error.message : "Unknown error"}
          </div>
          <Button size="sm" variant="outline" onClick={exit}>
            Back
          </Button>
        </div>
      </CenterMessage>
    );
  }

  if (items.length === 0) {
    return (
      <CenterMessage>
        <div className="space-y-2">
          <div>Your backlog is empty.</div>
          <div className="text-[11px] text-muted-foreground">
            Nothing to plan into a sprint yet. Once items land via sync, come back here.
          </div>
          <Button size="sm" variant="outline" onClick={exit}>
            Back to board
          </Button>
        </div>
      </CenterMessage>
    );
  }

  if (eligible.length === 0) {
    // Every item is done. Very unusual state but worth handling
    // distinctly from "no items at all".
    return (
      <CenterMessage>
        <div className="space-y-2">
          <div>Nothing open to plan.</div>
          <div className="text-[11px] text-muted-foreground">
            All your items are marked done. Take the win — or create something new.
          </div>
          <Button size="sm" variant="outline" onClick={exit}>
            Back to board
          </Button>
        </div>
      </CenterMessage>
    );
  }

  // Normal path — render the chosen view with a toggle.
  //
  // Hierarchy intent: keep the ambient album-art layer visible (sprint
  // is the one place we want it) by NOT painting an opaque wrapper.
  // Instead, every strip of foreground chrome (this toggle row, the
  // swipe progress row, the action bar) wraps with <ChromeBar> so it
  // reads cleanly against bright art. The actual focal point — the
  // CardFace / list / board — keeps its own opaque bg-card so it
  // stands out against the ambient. See AGENTS.md "Layout doctrine".
  const filterActive = plannedFilter.size > 0;

  return (
    <div className="flex h-full w-full flex-col">
      <ChromeBar className="flex flex-wrap items-center justify-between gap-3 px-5 py-2">
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Plan sprint ·{" "}
            {filterActive
              ? `${eligible.length} / ${eligibleAll.length}`
              : `${eligible.length} eligible`}
          </div>
          <PlannedChips
            value={plannedFilter}
            onToggle={togglePlanned}
            counts={plannedCounts}
          />
        </div>
        <ViewToggle view={view} onChange={switchView} />
      </ChromeBar>

      {view === "card" ? (
        <PlannerPrioritizeSwipe eligibleItems={eligible} />
      ) : view === "list" ? (
        <PlannerPrioritizeList eligibleItems={eligible} />
      ) : (
        <PlannerPrioritizeBoard eligibleItems={eligible} />
      )}
    </div>
  );
}

/**
 * Today / Overdue filter chips, sized for the planner's ChromeBar.
 * Multi-select like the board's chip set. Each chip shows its bucket
 * count and disables itself when the bucket is empty so the user
 * doesn't toggle into a guaranteed-empty state.
 */
function PlannedChips({
  value,
  onToggle,
  counts,
}: {
  value: Set<PlannedFilterValue>;
  onToggle: (v: PlannedFilterValue) => void;
  counts: { today: number; overdue: number };
}) {
  return (
    <div className="flex items-center gap-1">
      <PlannedChip
        active={value.has("today")}
        disabled={counts.today === 0}
        onClick={() => onToggle("today")}
        icon={<Sun aria-hidden className="h-2.5 w-2.5" />}
        label="Today"
        count={counts.today}
        tone="primary"
      />
      <PlannedChip
        active={value.has("overdue")}
        disabled={counts.overdue === 0}
        onClick={() => onToggle("overdue")}
        icon={<AlertCircle aria-hidden className="h-2.5 w-2.5" />}
        label="Overdue"
        count={counts.overdue}
        tone="amber"
      />
    </div>
  );
}

function PlannedChip({
  active,
  disabled,
  onClick,
  icon,
  label,
  count,
  tone,
}: {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count: number;
  tone: "primary" | "amber";
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-auto items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-normal transition-colors",
        active
          ? tone === "primary"
            ? "border-primary/50 bg-primary/15 text-foreground hover:bg-primary/15 hover:text-foreground"
            : "border-amber-500/50 bg-amber-500/15 text-foreground hover:bg-amber-500/15 hover:text-foreground"
          : "border-border/40 text-muted-foreground hover:bg-accent/40 hover:text-foreground",
        disabled && "opacity-40"
      )}
    >
      {icon}
      <span>{label}</span>
      {count > 0 && (
        <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
          {count}
        </span>
      )}
    </Button>
  );
}

function ViewToggle({
  view,
  onChange,
}: {
  view: ViewMode;
  onChange: (next: ViewMode) => void;
}) {
  return (
    <div className="inline-flex items-center gap-px rounded-md border border-border/40 p-px">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => onChange("card")}
        className={cn(
          "flex h-auto items-center gap-1 rounded px-2 py-1 text-[11px] font-normal transition-colors",
          view === "card"
            ? "bg-primary text-primary-foreground hover:bg-primary/95 hover:text-primary-foreground"
            : "text-muted-foreground hover:text-foreground"
        )}
        aria-pressed={view === "card"}
      >
        <LayoutGrid className="h-3 w-3" />
        Card
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => onChange("list")}
        className={cn(
          "flex h-auto items-center gap-1 rounded px-2 py-1 text-[11px] font-normal transition-colors",
          view === "list"
            ? "bg-primary text-primary-foreground hover:bg-primary/95 hover:text-primary-foreground"
            : "text-muted-foreground hover:text-foreground"
        )}
        aria-pressed={view === "list"}
      >
        <List className="h-3 w-3" />
        List
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => onChange("board")}
        className={cn(
          "flex h-auto items-center gap-1 rounded px-2 py-1 text-[11px] font-normal transition-colors",
          view === "board"
            ? "bg-primary text-primary-foreground hover:bg-primary/95 hover:text-primary-foreground"
            : "text-muted-foreground hover:text-foreground"
        )}
        aria-pressed={view === "board"}
      >
        <Columns3 className="h-3 w-3" />
        Board
      </Button>
    </div>
  );
}

function CenterMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-1 items-center justify-center p-8 text-center">
      <div className="space-y-2 text-[12px] text-muted-foreground">{children}</div>
    </div>
  );
}
