"use client";

// translucency-audit-ok: file — legacy callsites, migrate to sanctioned scale (/15, /40, /55, /60, /80, /95) case-by-case during component touch-ups.

/**
 * Kanban-style multi-select view for sprint planning. Third view mode
 * alongside Card (swipe) and List (dense flat). Groups eligibleItems by
 * status column (Backlog / To Do / In Progress / In Queue — Done is
 * excluded by the parent's eligible filter) and renders each card with
 * a checkbox so the user can pick items into the sprint.
 *
 * Same data + selection store as the other two views (useSprintStore),
 * so switching modes mid-pick preserves the user's selections.
 *
 * No drag-and-drop. This is a SELECTION surface, not a re-organization
 * surface — moving items between status columns belongs to /s2d board.
 */

import { useMemo } from "react";
import { Check, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSprintStore } from "@/store/sprint-store";
import { PathwayBadge } from "@/components/shared/pathway-badge";
import { PriorityDot } from "@/components/shared/priority-dot";
import { CompanyBadge } from "@/components/shared/company-badge";
import { SourceIcon } from "@/components/shared/source-icon";
import { STATUS_META, type S2DItem, type S2DStatus } from "@/types";
import { cn } from "@/lib/utils";

interface Props {
  eligibleItems: S2DItem[];
}

// Status columns shown in this view. "done" is excluded by the parent
// (eligibleForSprint filters status !== "done"); leaving it out here
// is belt-and-suspenders so a stale done item from a refetch race
// can't accidentally land in a column.
const COLUMN_ORDER: S2DStatus[] = [
  "backlog",
  "todo",
  "in_progress",
  "in_queue",
];

export function PlannerPrioritizeBoard({ eligibleItems }: Props) {
  const selected = useSprintStore((s) => s.selectedItemIds);
  const toggle = useSprintStore((s) => s.toggleSelected);
  const setPhase = useSprintStore((s) => s.setPhase);
  const exit = useSprintStore((s) => s.exitSprint);

  const grouped = useMemo(() => {
    const out: Record<S2DStatus, S2DItem[]> = {
      backlog: [],
      todo: [],
      in_progress: [],
      in_queue: [],
      done: [],
    };
    for (const it of eligibleItems) {
      if (it.status === "done") continue;
      out[it.status].push(it);
    }
    return out;
  }, [eligibleItems]);

  function lockIn() {
    if (selected.length === 0) return;
    setPhase("schedule");
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Columns row */}
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4">
        {COLUMN_ORDER.map((status) => {
          const items = grouped[status];
          const meta = STATUS_META[status];
          const selectedHere = items.filter((it) => selected.includes(it.id)).length;
          return (
            <div
              key={status}
              className="flex h-full min-h-0 w-72 shrink-0 flex-col rounded-md border border-border/40 bg-secondary/20"
            >
              <div className="flex items-center justify-between border-b border-border/40 px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground/80">
                    {meta.label}
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {items.length}
                  </span>
                </div>
                {selectedHere > 0 && (
                  <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-semibold text-primary">
                    {selectedHere} picked
                  </span>
                )}
              </div>
              <div className="flex-1 space-y-1.5 overflow-y-auto p-2">
                {items.length === 0 ? (
                  <div className="flex h-16 items-center justify-center rounded border border-dashed border-border/40 text-[11px] text-muted-foreground/70">
                    Nothing here.
                  </div>
                ) : (
                  items.map((it) => (
                    <BoardCard
                      key={it.id}
                      item={it}
                      checked={selected.includes(it.id)}
                      onToggle={() => toggle(it.id)}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom toolbar — matches the affordance the List + Card views give */}
      <div className="flex items-center justify-between border-t border-border/40 bg-card px-5 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-[12px] font-medium">
            {selected.length === 0
              ? "Tick the items you want in this sprint."
              : `${selected.length} item${selected.length === 1 ? "" : "s"} in sprint`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={exit}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={selected.length === 0}
            onClick={lockIn}
            className="gap-1.5"
          >
            <Check className="h-3.5 w-3.5" />
            {selected.length === 0 ? "Nothing to lock in" : "Lock in & schedule"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function BoardCard({
  item,
  checked,
  onToggle,
}: {
  item: S2DItem;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      onClick={onToggle}
      className={cn(
        "group cursor-pointer rounded-md border border-border/60 bg-card p-2.5 transition-colors hover:border-primary/40 hover:bg-accent/30",
        checked && "border-primary/60 bg-primary/5 ring-1 ring-primary/40"
      )}
    >
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          onClick={(e) => e.stopPropagation()}
          className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer accent-primary"
          aria-label={`Add ${item.title} to sprint`}
        />
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-1.5">
            {item.ticket_number != null && (
              <span className="font-mono text-[10px] text-muted-foreground/80">
                MASH-{item.ticket_number}
              </span>
            )}
            {item.source_type && <SourceIcon type={item.source_type} />}
            <PathwayBadge pathway={item.pathway} />
            <PriorityDot priority={item.priority} className="ml-auto" />
          </div>
          <div className="text-[12px] leading-snug text-foreground/95">
            {item.title}
          </div>
          {item.description && (
            <div className="mt-1 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
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
        </div>
      </div>
    </div>
  );
}
