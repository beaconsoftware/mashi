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

import { useEffect, useState } from "react";
import { LayoutGrid, List, Columns3 } from "lucide-react";
import { useS2DItems } from "@/hooks/use-s2d";
import { useSprintStore } from "@/store/sprint-store";
import { Button } from "@/components/ui/button";
import { PlannerPrioritizeSwipe } from "./planner-prioritize-swipe";
import { PlannerPrioritizeList } from "./planner-prioritize-list";
import { PlannerPrioritizeBoard } from "./planner-prioritize-board";
import type { S2DItem } from "@/types";
import { cn } from "@/lib/utils";

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
 * IMPORTANT: we DO NOT filter out items where sprint_date === today.
 * Previously we did — that's what caused the "Deck cleared with 150 open
 * items" bug. If the user had already planned a sprint with most items,
 * the filter ate them all and the planner looked empty. Better behavior:
 * include them, mark them "in sprint", and let the user re-confirm.
 */
export function eligibleForSprint(items: S2DItem[]): S2DItem[] {
  const eligible = items.filter((it) => it.status !== "done");
  eligible.sort((a, b) => {
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

  const eligible = eligibleForSprint(items);

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
  return (
    <div className="flex h-full w-full flex-col">
      {/* View toggle row */}
      <div className="flex items-center justify-between border-b border-border/30 px-5 py-2">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
          Plan sprint · {eligible.length} eligible
        </div>
        <ViewToggle view={view} onChange={switchView} />
      </div>

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

function ViewToggle({
  view,
  onChange,
}: {
  view: ViewMode;
  onChange: (next: ViewMode) => void;
}) {
  return (
    <div className="inline-flex items-center gap-px rounded-md border border-border/40 p-px">
      <button
        type="button"
        onClick={() => onChange("card")}
        className={cn(
          "flex items-center gap-1 rounded px-2 py-1 text-[11px] transition-colors",
          view === "card"
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:text-foreground"
        )}
        aria-pressed={view === "card"}
      >
        <LayoutGrid className="h-3 w-3" />
        Card
      </button>
      <button
        type="button"
        onClick={() => onChange("list")}
        className={cn(
          "flex items-center gap-1 rounded px-2 py-1 text-[11px] transition-colors",
          view === "list"
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:text-foreground"
        )}
        aria-pressed={view === "list"}
      >
        <List className="h-3 w-3" />
        List
      </button>
      <button
        type="button"
        onClick={() => onChange("board")}
        className={cn(
          "flex items-center gap-1 rounded px-2 py-1 text-[11px] transition-colors",
          view === "board"
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:text-foreground"
        )}
        aria-pressed={view === "board"}
      >
        <Columns3 className="h-3 w-3" />
        Board
      </button>
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
