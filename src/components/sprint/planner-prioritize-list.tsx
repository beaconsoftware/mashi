"use client";

// translucency-audit-ok: file — legacy callsites, migrate to sanctioned scale (/15, /40, /55, /60, /80, /95) case-by-case during component touch-ups.

/**
 * Compact multi-select list view for sprint planning. Alternative to
 * the card-deck swipe UI. Same data, same actions — just a denser
 * presentation for users who want to see the whole backlog at once.
 *
 * Receives a pre-filtered + sorted `eligibleItems` array from
 * PlannerPrioritizeShell. The shell handles loading / empty / error
 * states uniformly across both views.
 */

import { useMemo, useState } from "react";
import {
  Check,
  X,
  Filter as FilterIcon,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSprintStore } from "@/store/sprint-store";
import { PathwayBadge } from "@/components/shared/pathway-badge";
import { PriorityDot } from "@/components/shared/priority-dot";
import { CompanyBadge } from "@/components/shared/company-badge";
import { SourceIcon } from "@/components/shared/source-icon";
import { PRIORITY_META, PATHWAY_META, type S2DItem } from "@/types";
import { cn } from "@/lib/utils";

interface Props {
  eligibleItems: S2DItem[];
}

export function PlannerPrioritizeList({ eligibleItems }: Props) {
  const selected = useSprintStore((s) => s.selectedItemIds);
  const toggle = useSprintStore((s) => s.toggleSelected);
  const setPhase = useSprintStore((s) => s.setPhase);
  const exit = useSprintStore((s) => s.exitSprint);

  const [query, setQuery] = useState("");
  const [pathwayFilter, setPathwayFilter] = useState<string>("");
  const [priorityFilter, setPriorityFilter] = useState<string>("");
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return eligibleItems.filter((it) => {
      if (showSelectedOnly && !selected.includes(it.id)) return false;
      if (pathwayFilter && it.pathway !== pathwayFilter) return false;
      if (priorityFilter && it.priority !== priorityFilter) return false;
      if (q) {
        const hay = `${it.title}\n${it.description ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [eligibleItems, query, pathwayFilter, priorityFilter, showSelectedOnly, selected]);

  function selectAllVisible() {
    for (const it of filtered) {
      if (!selected.includes(it.id)) toggle(it.id);
    }
  }
  function clearAll() {
    for (const id of [...selected]) toggle(id);
  }
  function lockIn() {
    if (selected.length === 0) return;
    setPhase("schedule");
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border/30 px-5 py-2">
        <FilterIcon className="h-3 w-3 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by title…"
          className="h-7 max-w-xs text-[12px]"
        />
        <select
          value={pathwayFilter}
          onChange={(e) => setPathwayFilter(e.target.value)}
          className="h-7 rounded border border-border/40 bg-secondary px-2 text-[11px]"
        >
          <option value="">All action types</option>
          {Object.entries(PATHWAY_META).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
          className="h-7 rounded border border-border/40 bg-secondary px-2 text-[11px]"
        >
          <option value="">All priorities</option>
          {Object.entries(PRIORITY_META).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <input
            type="checkbox"
            checked={showSelectedOnly}
            onChange={(e) => setShowSelectedOnly(e.target.checked)}
            className="h-3 w-3"
          />
          Selected only ({selected.length})
        </label>
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            onClick={selectAllVisible}
            disabled={filtered.length === 0}
            className="h-7 text-[11px]"
          >
            Select all visible
          </Button>
          {selected.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={clearAll}
              className="h-7 text-[11px] text-muted-foreground"
            >
              Clear ({selected.length})
            </Button>
          )}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-[12px] text-muted-foreground">
            {eligibleItems.length === 0
              ? "Nothing eligible to plan."
              : "No items match your filters."}
          </div>
        ) : (
          <ul className="divide-y divide-border/20">
            {filtered.map((it) => (
              <ListRow
                key={it.id}
                item={it}
                selected={selected.includes(it.id)}
                onToggle={() => toggle(it.id)}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-border/30 px-5 py-2.5">
        <div className="text-[11px] text-muted-foreground">
          {filtered.length} of {eligibleItems.length} shown · {selected.length} in
          sprint
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={exit}>
            <X className="h-3.5 w-3.5" /> Cancel
          </Button>
          <Button
            size="sm"
            onClick={lockIn}
            disabled={selected.length === 0}
            className="gap-1.5"
          >
            <Check className="h-3.5 w-3.5" />
            Lock in {selected.length > 0 ? `(${selected.length})` : ""}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ListRow({
  item,
  selected,
  onToggle,
}: {
  item: S2DItem;
  selected: boolean;
  onToggle: () => void;
}) {
  const todayIso = new Date().toISOString().slice(0, 10);
  const alreadyInToday = item.sprint_date === todayIso;
  const priorityMeta = PRIORITY_META[item.priority];

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "flex w-full items-center gap-2 px-5 py-2 text-left transition-colors hover:bg-accent/20",
          selected && "bg-primary/10 hover:bg-primary/15"
        )}
      >
        <div
          className={cn(
            "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
            selected
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border/60"
          )}
        >
          {selected && <Check className="h-3 w-3" />}
        </div>
        <span className="w-14 font-mono text-[10px] text-muted-foreground">
          MASH-{item.ticket_number}
        </span>
        {item.source_type && (
          <SourceIcon
            type={item.source_type as Parameters<typeof SourceIcon>[0]["type"]}
          />
        )}
        <span className="line-clamp-1 flex-1 text-[12px] text-foreground/90">
          {item.title}
        </span>
        {alreadyInToday && (
          <span className="shrink-0 rounded bg-primary/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-primary">
            <Sparkles className="mr-0.5 inline-block h-2.5 w-2.5" />
            today
          </span>
        )}
        {item.company && (
          <div className="hidden shrink-0 md:block">
            <CompanyBadge company={item.company} />
          </div>
        )}
        <PathwayBadge pathway={item.pathway} compact />
        <div
          className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px]"
          style={{
            background: `${priorityMeta.color}22`,
            color: priorityMeta.color,
          }}
        >
          <PriorityDot priority={item.priority} />
          {priorityMeta.label}
        </div>
        {item.est_minutes != null && (
          <span className="shrink-0 rounded border border-border/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            {item.est_minutes}m
          </span>
        )}
      </button>
    </li>
  );
}
