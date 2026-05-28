"use client";

// translucency-audit-ok: file — legacy callsites, migrate to sanctioned scale (/15, /40, /55, /60, /80, /95) case-by-case during component touch-ups.

import { useRef, type MouseEvent as ReactMouseEvent } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useGSAP } from "@gsap/react";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { S2DItem } from "@/types";
import { SourceIcon } from "@/components/shared/source-icon";
import { PathwayBadge } from "@/components/shared/pathway-badge";
import { PriorityDot } from "@/components/shared/priority-dot";
import { CompanyBadge } from "@/components/shared/company-badge";
import { PlannedBadge } from "@/components/shared/planned-badge";
import { useS2DStore } from "@/store/s2d-store";
import { gsap, withMotion } from "@/lib/animation";
import { useMagneticHover, useSelectBurst } from "@/lib/animation/interactions";
import { AskMashiButton } from "@/components/agent/ask-mashi-button";
import { Checkbox } from "@/components/ui/checkbox";

interface Props {
  item: S2DItem;
  isOverlay?: boolean;
  /**
   * Card density. "compact" (default) shows ticket / source / pathway /
   * title / company / est — no description. "expanded" additionally
   * surfaces a 2-line clamped description so the user can size up the
   * work without opening the sheet. Board-level toggle controls this
   * across every card on the board.
   */
  density?: "compact" | "expanded";
  /**
   * Column key for shift-range selection. Cards from the same column
   * share an anchor; cards in different columns fall back to a single
   * toggle.
   */
  column?: string;
  /** Ordered ids in the same column (for shift-range). */
  columnIds?: string[];
}

export function S2DItemCard({
  item,
  isOverlay,
  density = "compact",
  column,
  columnIds,
}: Props) {
  const setSheetItem = useS2DStore((s) => s.setSelectedItem);
  const sheetId = useS2DStore((s) => s.selectedItemId);
  const isSheetOpen = sheetId === item.id;
  const multiSelected = useS2DStore((s) => s.selectedItemIds.has(item.id));
  const toggleSelected = useS2DStore((s) => s.toggleSelected);
  const selectRange = useS2DStore((s) => s.selectRange);
  // For the visual select burst we reuse the existing pattern.
  const isSelected = multiSelected;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    data: { type: "s2d", item },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const done = item.status === "done";
  const showUnseen = !!item.has_unseen_updates && !done;
  const dotRef = useRef<HTMLSpanElement | null>(null);

  // Magnetic hover lives on an INNER wrapper so it doesn't clobber the
  // outer transform that dnd-kit owns during drag. Same for the select
  // burst — anchored to inner wrapper.
  const { ref: hoverRef, onEnter, onLeave } = useMagneticHover<HTMLDivElement>({
    intensity: "soft",
    lift: 2,
  });
  const burstRef = useSelectBurst(isSelected);

  // Looping halo pulse around the unseen-updates dot. Only mounts when the
  // flag is true, so we don't need to kill a tween when it clears — the
  // ref unmounts and useGSAP's context cleanup handles it.
  useGSAP(
    () => {
      if (!showUnseen || !dotRef.current) return;
      const halo = dotRef.current.querySelector("[data-halo]");
      if (!halo) return;
      withMotion(() => {
        gsap.fromTo(
          halo,
          { scale: 0.8, opacity: 0.7 },
          {
            scale: 2.2,
            opacity: 0,
            duration: 1.4,
            ease: "sine.out",
            repeat: -1,
          }
        );
      });
    },
    { scope: dotRef, dependencies: [showUnseen] }
  );

  function handleCardClick(e: ReactMouseEvent<HTMLDivElement>) {
    // Cmd/Ctrl-click toggles selection without opening the sheet.
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      toggleSelected(item.id, column ?? item.status);
      return;
    }
    // Shift-click range selects within the same column.
    if (e.shiftKey && columnIds && column) {
      e.preventDefault();
      selectRange(columnIds, column, item.id);
      return;
    }
    setSheetItem(item.id);
  }

  function handleCheckboxClick(e: ReactMouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    if (e.shiftKey && columnIds && column) {
      selectRange(columnIds, column, item.id);
      return;
    }
    toggleSelected(item.id, column ?? item.status);
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={handleCardClick}
      data-s2d-card
      data-s2d-card-id={item.id}
      className={cn(
        "group relative cursor-grab touch-none active:cursor-grabbing",
        isDragging && "opacity-40"
      )}
    >
      <div
        ref={(el) => {
          hoverRef.current = el;
          burstRef.current = el;
        }}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        className={cn(
          "relative rounded-md border border-border/60 bg-card p-2.5 text-left transition-colors hover:border-primary/40 hover:bg-accent/30",
          isOverlay && "shadow-xl ring-1 ring-primary/50 rotate-1",
          isSheetOpen && !isSelected && "border-primary/40 ring-1 ring-primary/20",
          isSelected && "border-primary/60 bg-primary/5 ring-1 ring-primary/40 shadow-[0_0_20px_-6px_hsl(var(--primary)/0.5)]",
          done && "opacity-60"
        )}
      >
        {isSelected && (
          <span
            data-select-burst
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10 rounded-md bg-primary/30 blur-md"
          />
        )}
      {!isOverlay && (
        <span
          className="pointer-events-auto absolute -left-1 -top-1"
          // Modifiers listed in the title so the user can discover the
          // range / no-sheet-open shortcuts without docs.
          title={
            isSelected
              ? "Deselect. Shift-click for range."
              : "Select. Shift-click for range. Cmd-click anywhere on the card to select without opening it."
          }
        >
          <Checkbox
            checked={isSelected}
            onClick={handleCheckboxClick}
            // Radix's Checkbox doesn't forward onClick to the inner button
            // when also wired through Radix state — keep both so the
            // interaction works whether the user clicks the visible box
            // or its label area. We control selection state ourselves so
            // onCheckedChange is a noop (the click handler does the work).
            onCheckedChange={() => undefined}
            aria-label={`Select ${item.title}`}
            // Always visible at rest: previous opacity-30 fade combined
            // with `border-border/60 bg-card` made the box camouflage
            // perfectly against the card — selectability was invisible.
            // Use border-muted-foreground/60 for visible-but-quiet at
            // rest; Radix flips to primary fill on data-state=checked
            // automatically. Hover ring on the card body still signals
            // hit area.
            className="size-4 rounded border-muted-foreground/60 bg-background/80 shadow-md"
          />
        </span>
      )}
      {!isOverlay && (
        <span
          className={cn(
            "pointer-events-auto absolute top-1 opacity-0 transition-opacity group-hover:opacity-100",
            showUnseen ? "right-5" : "right-1"
          )}
        >
          <AskMashiButton itemId={item.id} variant="ghost" />
        </span>
      )}
      {showUnseen && (
        <span
          ref={dotRef}
          className="pointer-events-none absolute right-1.5 top-1.5 flex h-2 w-2 items-center justify-center"
          title={item.last_update_summary ?? "Updated"}
          aria-label="Has unseen updates"
        >
          <span
            data-halo
            className="absolute h-2 w-2 rounded-full bg-primary"
          />
          <span className="relative h-2 w-2 rounded-full bg-primary shadow-[0_0_6px_rgba(0,0,0,0.25)]" />
        </span>
      )}

      {/* Chip row: wraps when contents exceed card width. PriorityDot
          stays anchored to the right via ml-auto on the LAST line. */}
      <div className="mb-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1">
        {item.ticket_number != null && (
          <span className="font-mono text-[10px] text-muted-foreground/80">
            MASH-{item.ticket_number}
          </span>
        )}
        {item.source_type && <SourceIcon type={item.source_type} />}
        {(item.linked_sources?.length ?? 0) > 0 && (
          <span
            className="rounded border border-primary/30 bg-primary/10 px-1 py-0.5 text-[9px] font-medium text-primary"
            title={`Also tracked in ${item.linked_sources!.length} other source${item.linked_sources!.length === 1 ? "" : "s"}`}
          >
            +{item.linked_sources!.length}
          </span>
        )}
        <PathwayBadge pathway={item.pathway} />
        <PlannedBadge item={item} />
        <PriorityDot priority={item.priority} className="ml-auto" />
      </div>

      <div
        className={cn(
          "text-[13px] leading-snug text-foreground/95",
          done && "line-through text-muted-foreground"
        )}
      >
        {item.title}
      </div>

      {density === "expanded" && item.description && (
        <div
          className={cn(
            "mt-1.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground",
            done && "line-through"
          )}
        >
          {item.description}
        </div>
      )}

      <div className="mt-2 flex items-center gap-2">
        <CompanyBadge company={item.company} />
        {item.est_minutes != null && (
          <span className="ml-auto font-mono text-[10px] text-muted-foreground">
            {item.est_minutes}m
          </span>
        )}
      </div>

      {item.queue_reason && (
        <div className="mt-2 flex items-center gap-1.5 rounded border border-border/40 bg-secondary/40 px-1.5 py-1 text-[11px] text-muted-foreground">
          <Clock className="h-3 w-3 shrink-0" />
          <span className="truncate">{item.queue_reason}</span>
        </div>
      )}
      </div>
    </div>
  );
}
