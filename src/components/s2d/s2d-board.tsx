"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { AlertTriangle, CheckSquare, LayoutGrid, Maximize2, Minimize2, X, Zap } from "lucide-react";
import { S2DColumn } from "@/components/s2d/s2d-column";
import { S2DItemCard } from "@/components/s2d/s2d-item-card";
import { S2DItemSheet } from "@/components/s2d/s2d-item-sheet";
import { ReviewColumn } from "@/components/s2d/review-column";
import {
  S2DFilters,
  applyS2DFilters,
  parseFilterParams,
  serializeFilterParams,
  type S2DFilterState,
} from "@/components/s2d/s2d-filters";
import { STATUS_ORDER, type S2DItem, type S2DStatus, PATHWAY_META, PRIORITY_META } from "@/types";
import { useS2DItems, useUpdateS2DItem } from "@/hooks/use-s2d";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChromeBar } from "@/components/layout/primitives";

type BoardView = "cards" | "select";
type CardDensity = "compact" | "expanded";

const STORAGE_KEY_VIEW = "mashi:s2d-view";
const STORAGE_KEY_DENSITY = "mashi:s2d-density";

function readLocal<T extends string>(key: string, fallback: T, valid: readonly T[]): T {
  if (typeof window === "undefined") return fallback;
  const v = window.localStorage.getItem(key);
  return v && (valid as readonly string[]).includes(v) ? (v as T) : fallback;
}

export function S2DBoard() {
  const { data: items = [], isLoading, isError } = useS2DItems();
  const updateItem = useUpdateS2DItem();

  // Filters live in the URL (?company=…&pathway=…&priority=…) so views
  // are shareable, survive reloads, and route changes don't blow them away.
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filters = useMemo<S2DFilterState>(
    () => parseFilterParams(searchParams),
    [searchParams]
  );
  const setFilters = useCallback(
    (next: S2DFilterState) => {
      const params = new URLSearchParams(searchParams.toString());
      // Strip the filter keys and re-set from `next`, so unrelated params survive
      params.delete("company");
      params.delete("pathway");
      params.delete("priority");
      for (const [k, v] of serializeFilterParams(next)) params.set(k, v);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams]
  );

  const filteredItems = useMemo(() => applyS2DFilters(items, filters), [items, filters]);

  const { reviewItems, grouped } = useMemo(() => {
    const out: Record<S2DStatus, S2DItem[]> = {
      backlog: [],
      todo: [],
      in_progress: [],
      in_queue: [],
      done: [],
    };
    const review: S2DItem[] = [];
    // Items flagged for review float to the dedicated Review column
    // regardless of their underlying status. Once approved, the flag
    // flips off and the item lands in its agent-recommended column.
    // Filtering happens here too — out goes the unfiltered list.
    for (const it of filteredItems) {
      if (it.needs_review) review.push(it);
      else out[it.status].push(it);
    }
    const priorityWeight: Record<S2DItem["priority"], number> = {
      urgent: 0,
      high: 1,
      medium: 2,
      low: 3,
    };
    const sortFn = (a: S2DItem, b: S2DItem) => {
      const w = priorityWeight[a.priority] - priorityWeight[b.priority];
      if (w !== 0) return w;
      return b.updated_at.localeCompare(a.updated_at);
    };
    (Object.keys(out) as S2DStatus[]).forEach((k) => out[k].sort(sortFn));
    review.sort((a, b) => b.created_at.localeCompare(a.created_at));
    return { reviewItems: review, grouped: out };
  }, [filteredItems]);

  const [activeItem, setActiveItem] = useState<S2DItem | null>(null);
  // Inline banner — surfaces drag/drop save failures so a network blip
  // doesn't silently roll back the cache after the card has snapped.
  const [banner, setBanner] = useState<{ kind: "err" | "ok"; msg: string } | null>(
    null
  );
  useEffect(() => {
    if (!banner) return;
    const id = setTimeout(() => setBanner(null), 8000);
    return () => clearTimeout(id);
  }, [banner]);

  // View-mode + density: persisted to localStorage so reload preserves
  // the user's choice. Lazy init avoids SSR window access.
  const [view, setView] = useState<BoardView>("cards");
  const [density, setDensity] = useState<CardDensity>("compact");
  useEffect(() => {
    setView(readLocal<BoardView>(STORAGE_KEY_VIEW, "cards", ["cards", "select"]));
    setDensity(
      readLocal<CardDensity>(STORAGE_KEY_DENSITY, "compact", ["compact", "expanded"])
    );
  }, []);
  function persistView(v: BoardView) {
    setView(v);
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY_VIEW, v);
    // Switching out of select mode clears the selection so a return-trip
    // doesn't surface stale checkmarks.
    if (v !== "select") setSelectedIds(new Set());
  }
  function persistDensity(d: CardDensity) {
    setDensity(d);
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY_DENSITY, d);
  }

  // Multi-select state for the "Add N to sprint" flow. Only meaningful
  // when view === "select". Set, not array, so toggles are O(1).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [addingToSprint, setAddingToSprint] = useState(false);
  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  async function addSelectedToSprint() {
    if (selectedIds.size === 0 || addingToSprint) return;
    setAddingToSprint(true);
    setBanner(null);
    const today = new Date().toISOString().slice(0, 10);
    const ids = [...selectedIds];
    const results = await Promise.allSettled(
      ids.map((id) =>
        updateItem.mutateAsync({
          id,
          patch: { sprint_date: today, sprint_type: "morning", status: "todo" },
        })
      )
    );
    const failed = results
      .map((r, i) => (r.status === "rejected" ? ids[i] : null))
      .filter((x): x is string => x != null);
    setAddingToSprint(false);
    if (failed.length > 0) {
      const failedLabels = failed
        .map((id) => {
          const it = items.find((x) => x.id === id);
          return it?.ticket_number != null ? `MASH-${it.ticket_number}` : id.slice(0, 8);
        })
        .join(", ");
      setBanner({
        kind: "err",
        msg: `${failed.length} of ${ids.length} couldn't be added (${failedLabels}). The rest landed on today's sprint.`,
      });
    } else {
      setBanner({
        kind: "ok",
        msg: `Added ${ids.length} item${ids.length === 1 ? "" : "s"} to today's sprint. Open the planner to schedule.`,
      });
    }
    // Always clear selection after attempt — successful items are
    // already in the sprint; failures are surfaced by ticket above
    // so the user can pick them again.
    setSelectedIds(new Set());
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  function onDragStart(e: DragStartEvent) {
    const it = items.find((i) => i.id === e.active.id);
    if (it) setActiveItem(it);
  }

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    setActiveItem(null);
    if (!over) return;

    const overData = over.data.current as
      | { type?: string; status?: S2DStatus | "review" }
      | undefined;
    const activeData = active.data.current as { type?: string; item?: S2DItem } | undefined;
    if (!activeData?.item) return;

    let targetStatus: S2DStatus | "review" | null = null;
    if (overData?.type === "column" && overData.status) {
      targetStatus = overData.status;
    } else if (overData?.type === "s2d") {
      const targetItem = items.find((i) => i.id === over.id);
      if (targetItem) {
        targetStatus = targetItem.needs_review ? "review" : targetItem.status;
      }
    }
    if (!targetStatus) return;

    const item = activeData.item;
    const currentCol = item.needs_review ? "review" : item.status;
    if (currentCol === targetStatus) return;

    const patch: Partial<S2DItem> = {};

    // Dragging out of review approves the item with its current values
    if (currentCol === "review" && targetStatus !== "review") {
      patch.needs_review = false;
      patch.status = targetStatus as S2DStatus;
    } else if (targetStatus === "review") {
      // Send back to review (useful if you accidentally approved)
      patch.needs_review = true;
    } else {
      patch.status = targetStatus as S2DStatus;
    }

    if (patch.status === "in_queue") {
      patch.queue_reason = `Moved to queue · ${new Date().toLocaleString(undefined, {
        weekday: "short",
        hour: "numeric",
        minute: "2-digit",
      })}`;
    } else if (patch.status) {
      patch.queue_reason = null;
    }
    if (patch.status === "done") {
      patch.done_at = new Date().toISOString();
      // Without these, drag-to-Done rows end up with null outcome/resolved_via,
      // which makes the sheet's outcome line blank and breaks analytics that
      // bucket closes by resolved_via.
      patch.outcome = "Closed from board";
      patch.resolved_via = "manual";
    }

    const ticket = item.ticket_number;
    updateItem.mutateAsync({ id: item.id, patch }).catch((err) => {
      setBanner({
        kind: "err",
        msg: `Couldn't move MASH-${ticket}: ${
          err instanceof Error ? err.message : "save failed"
        } — try again`,
      });
    });
  }

  if (isLoading) {
    return (
      <div className="flex h-full gap-3 p-4">
        {STATUS_ORDER.map((s) => (
          <div key={s} className="w-72 shrink-0 space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-8 text-sm text-destructive">
        Couldn&apos;t load your S2D board. Check that Supabase is running.
      </div>
    );
  }

  return (
    <>
      <div className="flex h-full min-h-0 flex-col">
        <S2DFilters
          state={filters}
          setState={setFilters}
          totalCount={items.length}
          filteredCount={filteredItems.length}
        />
        <BoardToolbar
          view={view}
          setView={persistView}
          density={density}
          setDensity={persistDensity}
          selectedCount={selectedIds.size}
          addingToSprint={addingToSprint}
          onAddSelectedToSprint={addSelectedToSprint}
          onClearSelection={() => setSelectedIds(new Set())}
        />
        {banner && (
          <div
            className={cn(
              "mx-4 mt-2 flex items-start gap-2 rounded border p-2 text-[12px]",
              banner.kind === "err"
                ? "border-destructive/40 bg-destructive/10 text-destructive"
                : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
            )}
          >
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="flex-1">{banner.msg}</span>
            <button
              onClick={() => setBanner(null)}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        {view === "cards" ? (
          <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
            <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4">
              <ReviewColumn items={reviewItems} />
              {STATUS_ORDER.map((status) => (
                <S2DColumn
                  key={status}
                  status={status}
                  items={grouped[status]}
                  density={density}
                />
              ))}
            </div>
            <DragOverlay>
              {activeItem && <S2DItemCard item={activeItem} isOverlay density={density} />}
            </DragOverlay>
          </DndContext>
        ) : (
          <SelectListView
            items={filteredItems.filter(
              (i) => i.status !== "done" && !i.needs_review
            )}
            selectedIds={selectedIds}
            onToggle={toggleSelected}
            onSelectAll={(ids) => setSelectedIds(new Set(ids))}
          />
        )}
      </div>
      <S2DItemSheet />
    </>
  );
}

/**
 * Toolbar that sits between filters and the board surface. Two responsibilities:
 *   1. Switch the board between "cards" (kanban) and "select" (flat list with
 *      checkboxes for bulk adding to a sprint).
 *   2. In "cards" mode, toggle card density compact / expanded — expanded
 *      surfaces the description as a 2-line clamp under the title.
 *
 * In "select" mode the density toggle is hidden (descriptions show inline on
 * the list rows already, so the toggle would have no visible effect) and the
 * selection chip + "Add N to sprint" button replace the density toggle.
 */
function BoardToolbar({
  view,
  setView,
  density,
  setDensity,
  selectedCount,
  addingToSprint,
  onAddSelectedToSprint,
  onClearSelection,
}: {
  view: BoardView;
  setView: (v: BoardView) => void;
  density: CardDensity;
  setDensity: (d: CardDensity) => void;
  selectedCount: number;
  addingToSprint: boolean;
  onAddSelectedToSprint: () => void;
  onClearSelection: () => void;
}) {
  return (
    <ChromeBar className="flex items-center gap-2 border-border/30 px-4 py-1.5 text-[11px]">
      <div className="flex overflow-hidden rounded-md border border-border/40">
        <ToolbarPill
          active={view === "cards"}
          onClick={() => setView("cards")}
          icon={<LayoutGrid className="h-3 w-3" />}
          label="Cards"
        />
        <ToolbarPill
          active={view === "select"}
          onClick={() => setView("select")}
          icon={<CheckSquare className="h-3 w-3" />}
          label="Select"
        />
      </div>

      {view === "cards" ? (
        <div className="flex overflow-hidden rounded-md border border-border/40">
          <ToolbarPill
            active={density === "compact"}
            onClick={() => setDensity("compact")}
            icon={<Minimize2 className="h-3 w-3" />}
            label="Compact"
          />
          <ToolbarPill
            active={density === "expanded"}
            onClick={() => setDensity("expanded")}
            icon={<Maximize2 className="h-3 w-3" />}
            label="Expanded"
          />
        </div>
      ) : (
        <div className="ml-2 flex items-center gap-2 text-muted-foreground">
          <span>{selectedCount} selected</span>
          {selectedCount > 0 && (
            <button
              onClick={onClearSelection}
              className="rounded px-1 py-0.5 hover:bg-accent hover:text-foreground"
            >
              clear
            </button>
          )}
        </div>
      )}

      <div className="ml-auto flex items-center gap-2">
        {view === "select" && (
          <Button
            size="sm"
            disabled={selectedCount === 0 || addingToSprint}
            onClick={onAddSelectedToSprint}
            className="h-7 gap-1.5"
          >
            <Zap className="h-3.5 w-3.5" />
            {addingToSprint
              ? "Adding…"
              : `Add ${selectedCount > 0 ? selectedCount : ""} to sprint`}
          </Button>
        )}
      </div>
    </ChromeBar>
  );
}

function ToolbarPill({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 px-2 py-1 transition-colors",
        active
          ? "bg-secondary text-foreground"
          : "text-muted-foreground hover:bg-accent/40 hover:text-foreground"
      )}
    >
      {icon}
      {label}
    </button>
  );
}

/**
 * Flat dense list with checkboxes — the "Select" mode of the board.
 *
 * Filters out done items and review-pending items (the review queue has
 * its own swipe deck, and done items aren't candidates for a sprint).
 * Rows are sorted by priority then updated_at so the top of the list is
 * always the most-urgent recent work — the natural sprint candidates.
 *
 * Single click on a row toggles selection (whole row is the click target,
 * not just the checkbox — fewer pixel-targets to hit on a touchpad).
 */
function SelectListView({
  items,
  selectedIds,
  onToggle,
  onSelectAll,
}: {
  items: S2DItem[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onSelectAll: (ids: string[]) => void;
}) {
  const priorityWeight: Record<S2DItem["priority"], number> = {
    urgent: 0,
    high: 1,
    medium: 2,
    low: 3,
  };
  const sorted = [...items].sort((a, b) => {
    const w = priorityWeight[a.priority] - priorityWeight[b.priority];
    if (w !== 0) return w;
    return b.updated_at.localeCompare(a.updated_at);
  });

  const allSelected = sorted.length > 0 && sorted.every((it) => selectedIds.has(it.id));

  if (sorted.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-[12px] text-muted-foreground">
        Nothing eligible. Items in Done or pending Review aren&apos;t sprint candidates.
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      <div className="mb-2 flex items-center gap-2 px-2 text-[10px] uppercase tracking-wider text-muted-foreground">
        <button
          onClick={() =>
            onSelectAll(allSelected ? [] : sorted.map((it) => it.id))
          }
          className="rounded border border-border/40 px-1.5 py-0.5 font-mono hover:bg-accent/40 hover:text-foreground"
        >
          {allSelected ? "deselect all" : "select all"}
        </button>
        <span>{sorted.length} eligible</span>
      </div>
      <ul className="divide-y divide-border/30 rounded-md border border-border/40 bg-card">
        {sorted.map((it) => {
          const checked = selectedIds.has(it.id);
          const pwMeta = PATHWAY_META[it.pathway];
          const prMeta = PRIORITY_META[it.priority];
          return (
            <li
              key={it.id}
              onClick={() => onToggle(it.id)}
              className={cn(
                "flex cursor-pointer items-center gap-3 px-3 py-2 transition-colors hover:bg-accent/30",
                checked && "bg-primary/5"
              )}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(it.id)}
                onClick={(e) => e.stopPropagation()}
                className="h-3.5 w-3.5 cursor-pointer accent-primary"
                aria-label={`Select ${it.title}`}
              />
              <span className="w-16 shrink-0 font-mono text-[10px] text-muted-foreground">
                MASH-{it.ticket_number}
              </span>
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: prMeta.color }}
                title={prMeta.label}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] font-medium">{it.title}</div>
                {it.description && (
                  <div className="truncate text-[11px] text-muted-foreground">
                    {it.description}
                  </div>
                )}
              </div>
              <span className="hidden shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground sm:inline">
                {pwMeta.shortLabel}
              </span>
              {it.est_minutes != null && (
                <span className="w-10 shrink-0 text-right font-mono text-[10px] text-muted-foreground">
                  {it.est_minutes}m
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
