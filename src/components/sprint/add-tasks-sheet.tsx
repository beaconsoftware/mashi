"use client";

/**
 * Phase 7: mid-sprint task picker.
 *
 * Right-side Sheet that surfaces every S2D item NOT already in the
 * running sprint's blocks. Each row exposes:
 *   - "Add to bench"  (always available)
 *   - "Add to slot N" (only when an active slot is free)
 *
 * Adds compose the existing `addItemMidSprint` store action; the
 * existing startedSetRef effect in sprint-active-mode-multi PATCHes
 * s2d_items.status to "in_progress" once the new item enters a slot.
 *
 * Sheet stays open across multiple adds — picking N items shouldn't
 * require N reopens. Closes only on user dismiss (Esc, outside click,
 * or the Close button).
 */

import { useMemo, useState } from "react";
import { Search, ArrowDownToLine, ArrowUpFromLine, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { PathwayBadge } from "@/components/shared/pathway-badge";
import { PriorityDot } from "@/components/shared/priority-dot";
import { CompanyBadge } from "@/components/shared/company-badge";
import { useS2DItems } from "@/hooks/use-s2d";
import {
  MAX_PARALLEL_SLOTS,
  useSprintStore,
} from "@/store/sprint-store";
import { PATHWAY_META, type Pathway, type Priority, type S2DItem } from "@/types";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Optional callback fired after a successful add so the host can
   * trigger the calendar-invite extension (Phase 7).
   */
  onAdded?: (s2dItemId: string, target: "bench" | "active") => void;
}

const PAGE_SIZE = 50;

export function AddTasksSheet({ open, onOpenChange, onAdded }: Props) {
  const { data: items } = useS2DItems();
  const blocks = useSprintStore((s) => s.blocks);
  const activeSlotIds = useSprintStore((s) => s.activeSlotIds);
  const addItemMidSprint = useSprintStore((s) => s.addItemMidSprint);

  const [query, setQuery] = useState("");
  const [pathwayFilter, setPathwayFilter] = useState<Pathway | "all">("all");
  const [priorityFilter, setPriorityFilter] = useState<Priority | "all">("all");
  const [limit, setLimit] = useState(PAGE_SIZE);

  // Items already in the sprint (any status) are excluded. So are
  // done items on the board and backlog items — the user clearly
  // hasn't elected those to active work yet.
  const blockIds = useMemo(() => new Set(blocks.map((b) => b.s2dItemId)), [blocks]);
  const available = useMemo(() => {
    const all = items ?? [];
    return all.filter((it) => {
      if (blockIds.has(it.id)) return false;
      if (it.status === "done" || it.status === "backlog") return false;
      return true;
    });
  }, [items, blockIds]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return available.filter((it) => {
      if (pathwayFilter !== "all" && it.pathway !== pathwayFilter) return false;
      if (priorityFilter !== "all" && it.priority !== priorityFilter) return false;
      if (!q) return true;
      const ticket = it.ticket_number != null ? `mash-${it.ticket_number}` : "";
      const hay = `${it.title} ${ticket} ${it.company?.name ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [available, query, pathwayFilter, priorityFilter]);

  const visible = filtered.slice(0, limit);
  const hasSlotRoom = activeSlotIds.length < MAX_PARALLEL_SLOTS;
  const nextSlotKey = activeSlotIds.length + 1;

  function handleAdd(item: S2DItem, target: "bench" | "active") {
    addItemMidSprint(item.id, target);
    onAdded?.(item.id, target);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md md:max-w-lg lg:max-w-xl">
        <SheetHeader className="border-b border-border/40">
          <SheetTitle className="text-base">Add tasks to sprint</SheetTitle>
          <SheetDescription>
            Pull items from the board into the running sprint. Stays open after each add.
          </SheetDescription>
        </SheetHeader>

        <div className="border-b border-border/40 p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setLimit(PAGE_SIZE);
              }}
              placeholder="Search title or MASH-…"
              className="h-9 pl-8 text-[13px]"
              autoFocus
            />
            {query && (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute right-1.5 top-1/2 h-6 w-6 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <FilterChip
              active={pathwayFilter === "all"}
              onClick={() => setPathwayFilter("all")}
            >
              All
            </FilterChip>
            {(Object.keys(PATHWAY_META) as Pathway[]).map((p) => (
              <FilterChip
                key={p}
                active={pathwayFilter === p}
                onClick={() => setPathwayFilter(p)}
              >
                {PATHWAY_META[p].shortLabel ?? PATHWAY_META[p].label}
              </FilterChip>
            ))}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <FilterChip
              active={priorityFilter === "all"}
              onClick={() => setPriorityFilter("all")}
            >
              Any priority
            </FilterChip>
            {(["urgent", "high", "medium", "low"] as Priority[]).map((p) => (
              <FilterChip
                key={p}
                active={priorityFilter === p}
                onClick={() => setPriorityFilter(p)}
              >
                <PriorityDot priority={p} />
                <span className="capitalize">{p}</span>
              </FilterChip>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {visible.length === 0 ? (
            <div className="px-4 py-12 text-center text-[12px] text-muted-foreground">
              {available.length === 0
                ? "Nothing left on the board to add."
                : "Nothing matches the current search and filters."}
            </div>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {visible.map((it) => (
                <PickerRow
                  key={it.id}
                  item={it}
                  hasSlotRoom={hasSlotRoom}
                  nextSlotKey={nextSlotKey}
                  onAdd={(target) => handleAdd(it, target)}
                />
              ))}
            </ul>
          )}
          {filtered.length > visible.length && (
            <div className="px-2 py-3 text-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setLimit((n) => n + PAGE_SIZE)}
              >
                Load more ({filtered.length - visible.length} left)
              </Button>
            </div>
          )}
        </div>

        <div className="border-t border-border/40 px-4 py-2 text-[10px] text-muted-foreground">
          {available.length} on board · {filtered.length} match
        </div>
      </SheetContent>
    </Sheet>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? "default" : "outline"}
      onClick={onClick}
      className={cn(
        "h-auto gap-1 rounded border px-2 py-0.5 text-[10px] font-normal",
        active
          ? "border-primary/60 bg-primary/15 text-foreground hover:bg-primary/15"
          : "border-border/40 bg-secondary/40 text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </Button>
  );
}

function PickerRow({
  item,
  hasSlotRoom,
  nextSlotKey,
  onAdd,
}: {
  item: S2DItem;
  hasSlotRoom: boolean;
  nextSlotKey: number;
  onAdd: (target: "bench" | "active") => void;
}) {
  return (
    <li className="flex items-start gap-2 rounded-md border border-border/40 bg-card p-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
          {item.ticket_number != null && (
            <span className="font-mono">MASH-{item.ticket_number}</span>
          )}
          <PriorityDot priority={item.priority} />
          <PathwayBadge pathway={item.pathway} compact />
          {item.company && <CompanyBadge company={item.company} />}
        </div>
        <div className="mt-1 line-clamp-2 text-[12px] font-medium leading-snug text-foreground">
          {item.title}
        </div>
      </div>
      <div className="flex shrink-0 flex-col gap-1">
        {hasSlotRoom && (
          <Button
            size="sm"
            onClick={() => onAdd("active")}
            className="h-7 gap-1 px-2 text-[11px]"
            title={`Pull into slot ${nextSlotKey}`}
          >
            <ArrowUpFromLine className="h-3 w-3" />
            Slot {nextSlotKey}
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={() => onAdd("bench")}
          className="h-7 gap-1 px-2 text-[11px]"
        >
          <ArrowDownToLine className="h-3 w-3" />
          Bench
        </Button>
      </div>
    </li>
  );
}
