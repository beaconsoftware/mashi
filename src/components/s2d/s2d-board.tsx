"use client";

import { useMemo, useState, useCallback } from "react";
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
import { STATUS_ORDER, type S2DItem, type S2DStatus } from "@/types";
import { useS2DItems, useUpdateS2DItem } from "@/hooks/use-s2d";
import { Skeleton } from "@/components/ui/skeleton";

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
    }

    updateItem.mutate({ id: item.id, patch });
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
        <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
          <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4">
            <ReviewColumn items={reviewItems} />
            {STATUS_ORDER.map((status) => (
              <S2DColumn key={status} status={status} items={grouped[status]} />
            ))}
          </div>
          <DragOverlay>{activeItem && <S2DItemCard item={activeItem} isOverlay />}</DragOverlay>
        </DndContext>
      </div>
      <S2DItemSheet />
    </>
  );
}
