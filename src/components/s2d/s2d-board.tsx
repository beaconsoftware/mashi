"use client";

// translucency-audit-ok: file — legacy callsites, migrate to sanctioned scale (/15, /40, /55, /60, /80, /95) case-by-case during component touch-ups.

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
import {
  AlertTriangle,
  Check,
  LayoutGrid,
  List as ListIcon,
  Maximize2,
  Minimize2,
  RotateCcw,
  X,
} from "lucide-react";
import { S2DColumn } from "@/components/s2d/s2d-column";
import { S2DItemCard } from "@/components/s2d/s2d-item-card";
import { S2DItemSheet } from "@/components/s2d/s2d-item-sheet";
import { ReviewColumn } from "@/components/s2d/review-column";
import {
  S2DFilterPopover,
  ActiveFilterChips,
  applyS2DFilters,
  applyQuickView,
  parseFilterParams,
  parseQuickView,
  serializeFilterParams,
  FILTER_PARAM_KEYS,
  type S2DFilterState,
  type QuickView,
} from "@/components/s2d/s2d-filters";
import {
  S2DSortDropdown,
  sortItems,
  parseSortParams,
  serializeSortParams,
  SORT_PARAM_KEYS,
  DEFAULT_SORT,
  type S2DSortState,
} from "@/components/s2d/s2d-sort";
import { S2DActionsDropdown, buildDonePatch, type BulkAction } from "@/components/s2d/s2d-actions";
import {
  STATUS_ORDER,
  type S2DItem,
  type S2DStatus,
  PATHWAY_META,
  PRIORITY_META,
} from "@/types";
import { useS2DItems, useUpdateS2DItem } from "@/hooks/use-s2d";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { ChromeBar } from "@/components/layout/primitives";
import { PlannedBadge } from "@/components/shared/planned-badge";
import { todayIso } from "@/lib/planned";
import { useS2DStore } from "@/store/s2d-store";

type BoardView = "cards" | "list";
type CardDensity = "compact" | "expanded";

const STORAGE_KEY_VIEW = "mashi:s2d-view";
const STORAGE_KEY_DENSITY = "mashi:s2d-density";
const UNDO_WINDOW_MS = 30_000;

function readLocal<T extends string>(key: string, fallback: T, valid: readonly T[]): T {
  if (typeof window === "undefined") return fallback;
  const v = window.localStorage.getItem(key);
  return v && (valid as readonly string[]).includes(v) ? (v as T) : fallback;
}

/** Snapshot of fields touched by a bulk Done, used to PATCH the item
 * back if the user clicks Undo within the 30s window. */
interface BulkDoneSnapshot {
  id: string;
  prev: Partial<S2DItem>;
}

export function S2DBoard() {
  const { data: items = [], isLoading, isError } = useS2DItems();
  const updateItem = useUpdateS2DItem();

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const filters = useMemo<S2DFilterState>(
    () => parseFilterParams(searchParams),
    [searchParams]
  );
  const quickView = useMemo<QuickView>(() => parseQuickView(searchParams), [searchParams]);
  const sort = useMemo<S2DSortState>(() => parseSortParams(searchParams), [searchParams]);

  const writeParams = useCallback(
    (mutate: (p: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams.toString());
      mutate(params);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams]
  );

  const setFilters = useCallback(
    (next: S2DFilterState) => {
      writeParams((params) => {
        for (const k of FILTER_PARAM_KEYS) params.delete(k);
        for (const [k, v] of serializeFilterParams(next)) params.set(k, v);
      });
    },
    [writeParams]
  );
  const setQuickView = useCallback(
    (next: QuickView) => {
      writeParams((params) => {
        if (next) params.set("view", next);
        else params.delete("view");
      });
    },
    [writeParams]
  );
  const setSort = useCallback(
    (next: S2DSortState) => {
      writeParams((params) => {
        for (const k of SORT_PARAM_KEYS) params.delete(k);
        for (const [k, v] of serializeSortParams(next)) params.set(k, v);
      });
    },
    [writeParams]
  );

  // Apply quick view first (narrows by computed planned-state), then
  // filters (narrows by static fields). Order doesn't change the result
  // set but keeps quickView semantics clear.
  const filteredItems = useMemo(
    () => applyS2DFilters(applyQuickView(items, quickView), filters),
    [items, filters, quickView]
  );

  const { reviewItems, grouped } = useMemo(() => {
    const out: Record<S2DStatus, S2DItem[]> = {
      backlog: [],
      todo: [],
      in_progress: [],
      in_queue: [],
      done: [],
    };
    const review: S2DItem[] = [];
    for (const it of filteredItems) {
      if (it.needs_review) review.push(it);
      else out[it.status].push(it);
    }
    (Object.keys(out) as S2DStatus[]).forEach((k) => {
      out[k] = sortItems(out[k], sort.mode, sort.order);
    });
    // Review column carves itself out of the sort — newest review
    // request first reads better as a swipe-deck queue.
    review.sort((a, b) => b.created_at.localeCompare(a.created_at));
    return { reviewItems: review, grouped: out };
  }, [filteredItems, sort]);

  // Multi-select lives in the store (so it survives Cards / List view
  // switches and any descendant can read/toggle without prop drilling).
  const selectedItemIds = useS2DStore((s) => s.selectedItemIds);
  const clearSelected = useS2DStore((s) => s.clearSelected);
  const setSelected = useS2DStore((s) => s.setSelected);
  const selectedItems = useMemo(
    () => items.filter((it) => selectedItemIds.has(it.id)),
    [items, selectedItemIds]
  );

  const [activeItem, setActiveItem] = useState<S2DItem | null>(null);
  const [banner, setBanner] = useState<{ kind: "err" | "ok"; msg: string } | null>(
    null
  );
  const [busy, setBusy] = useState(false);
  const [undoSnapshot, setUndoSnapshot] = useState<{
    items: BulkDoneSnapshot[];
    expiresAt: number;
  } | null>(null);

  useEffect(() => {
    if (!banner) return;
    const id = setTimeout(() => setBanner(null), 8000);
    return () => clearTimeout(id);
  }, [banner]);

  useEffect(() => {
    if (!undoSnapshot) return;
    // setTimeout with a non-positive delay fires on the next tick — no
    // need to branch and call setState directly inside the effect.
    const ms = Math.max(undoSnapshot.expiresAt - Date.now(), 0);
    const id = setTimeout(() => setUndoSnapshot(null), ms);
    return () => clearTimeout(id);
  }, [undoSnapshot]);

  const [view, setView] = useState<BoardView>("cards");
  const [density, setDensity] = useState<CardDensity>("compact");
  useEffect(() => {
    setView(readLocal<BoardView>(STORAGE_KEY_VIEW, "cards", ["cards", "list"]));
    setDensity(
      readLocal<CardDensity>(STORAGE_KEY_DENSITY, "compact", ["compact", "expanded"])
    );
  }, []);
  function persistView(v: BoardView) {
    setView(v);
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY_VIEW, v);
  }
  function persistDensity(d: CardDensity) {
    setDensity(d);
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY_DENSITY, d);
  }

  async function runBulkPatch(
    ids: string[],
    patchFor: (id: string) => Partial<S2DItem>,
    verbDone: string
  ): Promise<string[]> {
    const results = await Promise.allSettled(
      ids.map((id) => updateItem.mutateAsync({ id, patch: patchFor(id) }))
    );
    const failed = results
      .map((r, i) => (r.status === "rejected" ? ids[i] : null))
      .filter((x): x is string => x != null);
    if (failed.length > 0) {
      const failedLabels = failed
        .map((id) => {
          const it = items.find((x) => x.id === id);
          return it?.ticket_number != null ? `MASH-${it.ticket_number}` : id.slice(0, 8);
        })
        .join(", ");
      setBanner({
        kind: "err",
        msg: `${failed.length} of ${ids.length} couldn't be ${verbDone} (${failedLabels}). The rest landed.`,
      });
    } else {
      setBanner({
        kind: "ok",
        msg: `${ids.length} item${ids.length === 1 ? "" : "s"} ${verbDone}.`,
      });
    }
    return failed;
  }

  async function handleBulkAction(action: BulkAction) {
    if (selectedItems.length === 0 || busy) return;
    const ids = selectedItems.map((it) => it.id);
    setBusy(true);
    setBanner(null);

    try {
      switch (action.kind) {
        case "plan-today": {
          const planned_for = todayIso();
          await runBulkPatch(ids, () => ({ planned_for }), "planned for today");
          break;
        }
        case "plan-clear": {
          await runBulkPatch(ids, () => ({ planned_for: null }), "cleared from Today");
          break;
        }
        case "add-to-sprint": {
          await runBulkPatch(
            ids,
            () => ({
              sprint_date: todayIso(),
              sprint_type: "morning",
              status: "todo",
            }),
            "added to today's sprint"
          );
          break;
        }
        case "move-to": {
          const status = action.status;
          if (status === "done") {
            // Capture snapshot so the undo strip can PATCH items back.
            const snapshots: BulkDoneSnapshot[] = selectedItems.map((it) => ({
              id: it.id,
              prev: {
                status: it.status,
                done_at: it.done_at ?? null,
                outcome: it.outcome ?? null,
                resolved_via: it.resolved_via ?? null,
                queue_reason: it.queue_reason ?? null,
                needs_review: it.needs_review ?? false,
              },
            }));
            const failed = await runBulkPatch(
              ids,
              () => ({ ...buildDonePatch(), needs_review: false }),
              "marked done"
            );
            // Only snapshot the items that actually succeeded.
            const failedSet = new Set(failed);
            const succeeded = snapshots.filter((s) => !failedSet.has(s.id));
            if (succeeded.length > 0) {
              setUndoSnapshot({
                items: succeeded,
                expiresAt: Date.now() + UNDO_WINDOW_MS,
              });
            }
          } else if (status === "in_queue") {
            const queue_reason = `Moved to queue · ${new Date().toLocaleString(undefined, {
              weekday: "short",
              hour: "numeric",
              minute: "2-digit",
            })}`;
            await runBulkPatch(
              ids,
              () => ({ status, queue_reason, done_at: null, outcome: null, resolved_via: null }),
              "moved to In queue"
            );
          } else {
            await runBulkPatch(
              ids,
              () => ({
                status,
                queue_reason: null,
                done_at: null,
                outcome: null,
                resolved_via: null,
              }),
              `moved to ${status.replace("_", " ")}`
            );
          }
          break;
        }
        case "set-priority": {
          const priority = action.priority;
          await runBulkPatch(
            ids,
            () => ({ priority }),
            `set to ${priority} priority`
          );
          break;
        }
        case "send-to-review": {
          await runBulkPatch(
            ids,
            () => ({ needs_review: true }),
            "sent back to Review"
          );
          break;
        }
      }
    } finally {
      setBusy(false);
      clearSelected();
    }
  }

  async function applyUndo() {
    if (!undoSnapshot) return;
    setBusy(true);
    try {
      await Promise.allSettled(
        undoSnapshot.items.map((s) =>
          updateItem.mutateAsync({ id: s.id, patch: s.prev })
        )
      );
      setBanner({
        kind: "ok",
        msg: `Undid bulk Done for ${undoSnapshot.items.length} item${undoSnapshot.items.length === 1 ? "" : "s"}.`,
      });
    } finally {
      setUndoSnapshot(null);
      setBusy(false);
    }
  }

  // Click the "N selected" count to scroll the first selected item into
  // view — useful when the selection landed somewhere off-screen via
  // shift-range or a filtered subset that's since changed.
  function scrollToFirstSelected() {
    const firstId = selectedItems[0]?.id;
    if (!firstId) return;
    const el = document.querySelector<HTMLElement>(`[data-s2d-card-id="${firstId}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
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

    if (currentCol === "review" && targetStatus !== "review") {
      patch.needs_review = false;
      patch.status = targetStatus as S2DStatus;
    } else if (targetStatus === "review") {
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
      Object.assign(patch, buildDonePatch());
    }

    const ticket = item.ticket_number;
    updateItem.mutateAsync({ id: item.id, patch }).catch((err) => {
      setBanner({
        kind: "err",
        msg: `Couldn't move MASH-${ticket}: ${
          err instanceof Error ? err.message : "save failed"
        }, try again`,
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
        <BoardToolbar
          filters={filters}
          setFilters={setFilters}
          quickView={quickView}
          setQuickView={setQuickView}
          sort={sort}
          setSort={setSort}
          view={view}
          setView={persistView}
          density={density}
          setDensity={persistDensity}
          selected={selectedItems}
          totalCount={items.length}
          filteredCount={filteredItems.length}
          busy={busy}
          onAction={handleBulkAction}
          onClearSelection={clearSelected}
          onClickSelectionCount={scrollToFirstSelected}
        />
        <ActiveFilterChips state={filters} setState={setFilters} />

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
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setBanner(null)}
              aria-label="Dismiss"
              className="mashi-icon-glow h-5 w-5 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}

        {undoSnapshot && (
          <UndoBanner
            count={undoSnapshot.items.length}
            expiresAt={undoSnapshot.expiresAt}
            totalMs={UNDO_WINDOW_MS}
            onUndo={applyUndo}
            onDismiss={() => setUndoSnapshot(null)}
          />
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
          <ListView items={sortItems(filteredItems, sort.mode, sort.order)} onSetSelected={setSelected} />
        )}
      </div>
      <S2DItemSheet />
    </>
  );
}

function BoardToolbar({
  filters,
  setFilters,
  quickView,
  setQuickView,
  sort,
  setSort,
  view,
  setView,
  density,
  setDensity,
  selected,
  totalCount,
  filteredCount,
  busy,
  onAction,
  onClearSelection,
  onClickSelectionCount,
}: {
  filters: S2DFilterState;
  setFilters: (next: S2DFilterState) => void;
  quickView: QuickView;
  setQuickView: (next: QuickView) => void;
  sort: S2DSortState;
  setSort: (next: S2DSortState) => void;
  view: BoardView;
  setView: (v: BoardView) => void;
  density: CardDensity;
  setDensity: (d: CardDensity) => void;
  selected: S2DItem[];
  totalCount: number;
  filteredCount: number;
  busy: boolean;
  onAction: (action: BulkAction) => void;
  onClearSelection: () => void;
  onClickSelectionCount: () => void;
}) {
  const selectedCount = selected.length;
  const sortIsDefault = sort.mode === DEFAULT_SORT.mode && sort.order === DEFAULT_SORT.order;

  return (
    <ChromeBar className="flex flex-wrap items-center gap-2 border-border/30 px-4 py-1.5 text-[11px]">
      {/* Row 1: quick view tabs + filter + sort + total */}
      <div className="flex w-full flex-wrap items-center gap-2">
        <Tabs
          value={quickView ?? "all"}
          onValueChange={(v) => setQuickView(v === "all" ? null : (v as QuickView))}
        >
          <TabsList variant="line" className="h-7 gap-1">
            <TabsTrigger value="all" className="h-6 px-2 text-[11px]">
              All
            </TabsTrigger>
            <TabsTrigger value="today" className="h-6 px-2 text-[11px]">
              Today
            </TabsTrigger>
            <TabsTrigger value="overdue" className="h-6 px-2 text-[11px]">
              Overdue
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <S2DFilterPopover state={filters} setState={setFilters} />
        <S2DSortDropdown state={sort} setState={setSort} />

        {!sortIsDefault && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setSort(DEFAULT_SORT)}
            className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground"
          >
            Reset sort
          </Button>
        )}

        <span className="ml-auto font-mono text-[10px] text-muted-foreground tabular-nums">
          {filteredCount === totalCount
            ? `${totalCount} items`
            : `${filteredCount} / ${totalCount}`}
        </span>
      </div>

      {/* Row 2: view + density + selection chip + actions */}
      <div className="flex w-full flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-md border border-border/40">
          <ToolbarPill
            active={view === "cards"}
            onClick={() => setView("cards")}
            icon={<LayoutGrid className="h-3 w-3" />}
            label="Cards"
          />
          <ToolbarPill
            active={view === "list"}
            onClick={() => setView("list")}
            icon={<ListIcon className="h-3 w-3" />}
            label="List"
          />
        </div>

        {view === "cards" && (
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
        )}

        <div className="ml-auto flex items-center gap-2">
          {selectedCount > 0 && (
            <div className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 pl-2 pr-1 py-0.5 text-[11px] text-foreground/85">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onClickSelectionCount}
                className="h-auto px-0 py-0 text-[11px] font-medium tabular-nums hover:bg-transparent hover:underline underline-offset-2"
                title="Scroll to the first selected item"
              >
                {selectedCount} selected
              </Button>
              <span className="text-muted-foreground">·</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onClearSelection}
                className="h-auto rounded px-1 py-0.5 text-[11px] font-normal text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                clear
              </Button>
            </div>
          )}

          <S2DActionsDropdown
            selected={selected}
            busy={busy}
            onAction={onAction}
            onClear={onClearSelection}
          />
        </div>
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
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      className={cn(
        "h-auto rounded-none px-2 py-1 text-[11px] font-normal transition-colors",
        active
          ? "bg-secondary text-foreground hover:bg-secondary hover:text-foreground"
          : "text-muted-foreground hover:bg-accent/40 hover:text-foreground"
      )}
    >
      {icon}
      {label}
    </Button>
  );
}

function UndoBanner({
  count,
  expiresAt,
  totalMs,
  onUndo,
  onDismiss,
}: {
  count: number;
  expiresAt: number;
  totalMs: number;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  const [remainingMs, setRemainingMs] = useState(totalMs);
  useEffect(() => {
    const tick = () => {
      setRemainingMs(Math.max(expiresAt - Date.now(), 0));
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [expiresAt]);

  const seconds = Math.ceil(remainingMs / 1000);
  const pct = Math.max(0, Math.min(100, (remainingMs / totalMs) * 100));

  return (
    <div className="relative mx-4 mt-2 overflow-hidden rounded-md border border-amber-500/40 bg-amber-500/15 px-2.5 py-1.5">
      <div className="flex items-center gap-2 text-xs">
        <Check className="h-3 w-3 shrink-0 text-amber-400" />
        <span className="flex-1 truncate text-foreground/85">
          Marked {count} item{count === 1 ? "" : "s"} done.
        </span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onUndo}
          className="mashi-press h-6 gap-1 px-2 text-[11px]"
        >
          <RotateCcw className="h-3 w-3" />
          Undo
        </Button>
        <span className="font-mono text-[10px] tabular-nums text-muted-foreground/80">
          {seconds}s
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onDismiss}
          aria-label="Dismiss undo"
          className="mashi-icon-glow h-5 w-5 text-muted-foreground hover:text-foreground"
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-amber-500/40">
        <div
          className="h-full bg-amber-500/95 transition-[width] duration-200 ease-linear"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Flat list view, used when view === "list". Same item set as Cards
 * mode (filter + quick-view + sort already applied by the parent); no
 * extra eligibility narrowing — the Actions dropdown handles per-action
 * validity. Selection is shared with the store so it persists across
 * view switches.
 */
function ListView({
  items,
  onSetSelected,
}: {
  items: S2DItem[];
  onSetSelected: (ids: Iterable<string>) => void;
}) {
  const selectedIds = useS2DStore((s) => s.selectedItemIds);
  const toggleSelected = useS2DStore((s) => s.toggleSelected);
  const setSheetItem = useS2DStore((s) => s.setSelectedItem);

  if (items.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-[12px] text-muted-foreground">
        No items match the current filters.
      </div>
    );
  }

  const allSelected =
    items.length > 0 && items.every((it) => selectedIds.has(it.id));

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      <div className="mb-2 flex items-center gap-2 px-2 text-[10px] uppercase tracking-wider text-muted-foreground">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() =>
            onSetSelected(allSelected ? [] : items.map((it) => it.id))
          }
          className="h-auto rounded border border-border/40 px-1.5 py-0.5 text-[10px] font-mono font-normal uppercase tracking-wider hover:bg-accent/40 hover:text-foreground"
        >
          {allSelected ? "deselect all" : "select all"}
        </Button>
        <span>{items.length} items</span>
      </div>
      <ul className="divide-y divide-border/30 rounded-md border border-border/40 bg-card">
        {items.map((it) => {
          const checked = selectedIds.has(it.id);
          const pwMeta = PATHWAY_META[it.pathway];
          const prMeta = PRIORITY_META[it.priority];
          return (
            <li
              key={it.id}
              data-s2d-card-id={it.id}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey) {
                  e.preventDefault();
                  toggleSelected(it.id, "list");
                  return;
                }
                // Default list-row click toggles selection — mirrors the
                // current behavior of the legacy Select view that users
                // are familiar with. Open the sheet via the title link
                // below.
                toggleSelected(it.id, "list");
              }}
              className={cn(
                "flex cursor-pointer items-center gap-3 px-3 py-2 transition-colors hover:bg-accent/30",
                checked && "bg-primary/5"
              )}
            >
              <Checkbox
                checked={checked}
                onCheckedChange={() => toggleSelected(it.id, "list")}
                onClick={(e) => e.stopPropagation()}
                className="h-3.5 w-3.5 cursor-pointer"
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
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSheetItem(it.id);
                  }}
                  className="block h-auto w-full justify-start whitespace-normal rounded px-0 py-0 text-left font-normal hover:bg-transparent"
                >
                  <span className="block truncate text-[12px] font-medium hover:text-primary">
                    {it.title}
                  </span>
                  {it.description && (
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {it.description}
                    </span>
                  )}
                </Button>
              </div>
              <span className="hidden shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground sm:inline">
                {pwMeta.shortLabel}
              </span>
              <PlannedBadge item={it} className="shrink-0" />
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
