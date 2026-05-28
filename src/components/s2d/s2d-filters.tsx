"use client";

import { useMemo, useState } from "react";
import { Filter, X } from "lucide-react";
import { useCompanies } from "@/hooks/use-s2d";
import {
  PATHWAY_META,
  PRIORITY_META,
  type Pathway,
  type Priority,
  type S2DItem,
} from "@/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Checkbox } from "@/components/ui/checkbox";
import { getPlannedState } from "@/lib/planned";

export type QuickView = "today" | "overdue" | null;

export interface S2DFilterState {
  companies: Set<string>;
  pathways: Set<Pathway>;
  priorities: Set<Priority>;
}

export const EMPTY_FILTER: S2DFilterState = {
  companies: new Set(),
  pathways: new Set(),
  priorities: new Set(),
};

export const FILTER_PARAM_KEYS = ["company", "pathway", "priority"] as const;

const VALID_PATHWAYS = new Set(Object.keys(PATHWAY_META) as Pathway[]);
const VALID_PRIORITIES = new Set(Object.keys(PRIORITY_META) as Priority[]);
const VALID_QUICK_VIEW = new Set<Exclude<QuickView, null>>(["today", "overdue"]);

type ReadonlyURLSearchParams = Pick<URLSearchParams, "get" | "toString">;

export function parseFilterParams(
  searchParams: URLSearchParams | ReadonlyURLSearchParams
): S2DFilterState {
  function read(key: string): Set<string> {
    const raw = searchParams.get(key);
    if (!raw) return new Set();
    return new Set(raw.split(",").filter(Boolean));
  }
  return {
    companies: read("company"),
    pathways: new Set(
      [...read("pathway")].filter((p): p is Pathway =>
        VALID_PATHWAYS.has(p as Pathway)
      )
    ),
    priorities: new Set(
      [...read("priority")].filter((p): p is Priority =>
        VALID_PRIORITIES.has(p as Priority)
      )
    ),
  };
}

export function serializeFilterParams(s: S2DFilterState): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  if (s.companies.size > 0) out.push(["company", [...s.companies].join(",")]);
  if (s.pathways.size > 0) out.push(["pathway", [...s.pathways].join(",")]);
  if (s.priorities.size > 0) out.push(["priority", [...s.priorities].join(",")]);
  return out;
}

export function parseQuickView(
  searchParams: URLSearchParams | ReadonlyURLSearchParams
): QuickView {
  const raw = searchParams.get("view");
  if (!raw) return null;
  if (VALID_QUICK_VIEW.has(raw as Exclude<QuickView, null>))
    return raw as Exclude<QuickView, null>;
  return null;
}

/** Apply current filter state to an items array. Empty sets in a dimension
 * mean "all" so a filter with nothing selected returns everything. */
export function applyS2DFilters(items: S2DItem[], f: S2DFilterState): S2DItem[] {
  return items.filter((it) => {
    if (
      f.companies.size > 0 &&
      (!it.company_id || !f.companies.has(it.company_id))
    )
      return false;
    if (f.pathways.size > 0 && !f.pathways.has(it.pathway)) return false;
    if (f.priorities.size > 0 && !f.priorities.has(it.priority)) return false;
    return true;
  });
}

/** Quick view narrows the working set further. Today/Overdue match the
 * computed planned-state; null means no narrowing. */
export function applyQuickView(items: S2DItem[], view: QuickView): S2DItem[] {
  if (!view) return items;
  return items.filter((it) => getPlannedState(it) === view);
}

/**
 * Number of distinct dimensions with at least one active value. Used by
 * the Filter button badge so the user can see at a glance how busy their
 * filter is without expanding the popover.
 */
export function activeDimensionCount(f: S2DFilterState): number {
  return (
    (f.companies.size > 0 ? 1 : 0) +
    (f.pathways.size > 0 ? 1 : 0) +
    (f.priorities.size > 0 ? 1 : 0)
  );
}

export function S2DFilterPopover({
  state,
  setState,
}: {
  state: S2DFilterState;
  setState: (next: S2DFilterState) => void;
}) {
  const { data: companies = [] } = useCompanies();
  const [open, setOpen] = useState(false);

  const activeCount = activeDimensionCount(state);

  function toggleCompany(id: string) {
    const next = new Set(state.companies);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setState({ ...state, companies: next });
  }
  function togglePathway(p: Pathway) {
    const next = new Set(state.pathways);
    if (next.has(p)) next.delete(p);
    else next.add(p);
    setState({ ...state, pathways: next });
  }
  function togglePriority(p: Priority) {
    const next = new Set(state.priorities);
    if (next.has(p)) next.delete(p);
    else next.add(p);
    setState({ ...state, priorities: next });
  }
  function clearAll() {
    setState(EMPTY_FILTER);
  }

  const sortedCompanies = useMemo(
    () => [...companies].sort((a, b) => a.name.localeCompare(b.name)),
    [companies]
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn(
            "mashi-magnetic h-7 gap-1.5 text-[11px] transition-colors",
            // Filter button "carries its own state": when filters are
            // applied, swap the entire button to a primary-tinted look
            // rather than relying on a tiny badge to communicate it.
            activeCount > 0
              ? "border-primary/40 bg-primary/15 text-foreground hover:bg-primary/15 hover:text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Filter
            className={cn(
              "h-3 w-3 transition-colors",
              activeCount > 0 && "text-primary"
            )}
          />
          Filter
          {activeCount > 0 && (
            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
              {activeCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 max-h-[60vh] overflow-hidden p-0"
      >
        <div className="flex max-h-[60vh] flex-col">
          <Command className="flex-1">
            <div className="border-b border-border/40 px-2 pt-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Company
              </span>
            </div>
            <CommandInput placeholder="Search company" className="h-9" />
            <CommandList className="max-h-48">
              <CommandEmpty>No companies match.</CommandEmpty>
              <CommandGroup>
                {sortedCompanies.map((c) => {
                  const on = state.companies.has(c.id);
                  return (
                    <CommandItem
                      key={c.id}
                      value={c.name}
                      onSelect={() => toggleCompany(c.id)}
                      className="flex items-center gap-2"
                    >
                      <Checkbox
                        checked={on}
                        className="h-3.5 w-3.5"
                        aria-label={`Filter by ${c.name}`}
                      />
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: c.color_hex }}
                      />
                      <span className="flex-1 truncate text-[12px]">{c.name}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>

          <div className="border-t border-border/40 p-2">
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Action type
            </div>
            <div className="flex flex-wrap gap-1">
              {(Object.keys(PATHWAY_META) as Pathway[]).map((p) => {
                const meta = PATHWAY_META[p];
                const on = state.pathways.has(p);
                return (
                  <FilterChip key={p} active={on} onClick={() => togglePathway(p)}>
                    <span className="text-[10px]">{meta.icon}</span>
                    {meta.shortLabel}
                  </FilterChip>
                );
              })}
            </div>
          </div>

          <div className="border-t border-border/40 p-2">
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Priority
            </div>
            <div className="flex flex-wrap gap-1">
              {(Object.keys(PRIORITY_META) as Priority[]).map((p) => {
                const meta = PRIORITY_META[p];
                const on = state.priorities.has(p);
                return (
                  <FilterChip
                    key={p}
                    active={on}
                    onClick={() => togglePriority(p)}
                    accent={meta.color}
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: meta.color }}
                    />
                    {meta.label}
                  </FilterChip>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-border/40 px-2 py-1.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={clearAll}
              disabled={activeCount === 0}
              className="h-7 text-[11px]"
            >
              Clear all
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
              className="h-7 text-[11px]"
            >
              Done
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function FilterChip({
  active,
  onClick,
  children,
  accent,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  accent?: string;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onClick}
      className={cn(
        "inline-flex h-auto items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-normal transition-colors",
        active
          ? "border-primary/50 bg-primary/15 text-foreground hover:bg-primary/15 hover:text-foreground"
          : "border-border/40 text-muted-foreground hover:bg-accent/40 hover:text-foreground"
      )}
      style={active && accent ? { boxShadow: `0 0 10px -2px ${accent}` } : undefined}
    >
      {children}
    </Button>
  );
}

/**
 * Thin row of removable chips, one per active filter value. Renders
 * nothing when no filters are active. Placed below the toolbar (NOT
 * inside the chrome bar) so toolbar height stays predictable.
 */
export function ActiveFilterChips({
  state,
  setState,
}: {
  state: S2DFilterState;
  setState: (next: S2DFilterState) => void;
}) {
  const { data: companies = [] } = useCompanies();
  const anyActive =
    state.companies.size > 0 ||
    state.pathways.size > 0 ||
    state.priorities.size > 0;
  if (!anyActive) return null;

  const companyName = (id: string) =>
    companies.find((c) => c.id === id)?.name ?? id.slice(0, 6);

  function removeCompany(id: string) {
    const next = new Set(state.companies);
    next.delete(id);
    setState({ ...state, companies: next });
  }
  function removePathway(p: Pathway) {
    const next = new Set(state.pathways);
    next.delete(p);
    setState({ ...state, pathways: next });
  }
  function removePriority(p: Priority) {
    const next = new Set(state.priorities);
    next.delete(p);
    setState({ ...state, priorities: next });
  }

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-border/30 bg-background/40 px-4 py-1.5 text-[11px]">
      {[...state.companies].map((id) => (
        <RemovableChip key={`c-${id}`} label="Company" value={companyName(id)} onRemove={() => removeCompany(id)} />
      ))}
      {[...state.pathways].map((p) => (
        <RemovableChip
          key={`pw-${p}`}
          label="Type"
          value={PATHWAY_META[p].shortLabel}
          onRemove={() => removePathway(p)}
        />
      ))}
      {[...state.priorities].map((p) => (
        <RemovableChip
          key={`pr-${p}`}
          label="Priority"
          value={PRIORITY_META[p].label}
          accent={PRIORITY_META[p].color}
          onRemove={() => removePriority(p)}
        />
      ))}
    </div>
  );
}

function RemovableChip({
  label,
  value,
  accent,
  onRemove,
}: {
  label: string;
  value: string;
  accent?: string;
  onRemove: () => void;
}) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-border/40 bg-secondary/40 py-0.5 pl-2 pr-1 text-[11px] text-foreground/85"
      style={accent ? { boxShadow: `0 0 8px -3px ${accent}` } : undefined}
    >
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-medium">{value}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onRemove}
        aria-label={`Remove ${label} ${value}`}
        className="mashi-icon-glow h-4 w-4 rounded-full text-muted-foreground hover:text-foreground"
      >
        <X className="h-2.5 w-2.5" />
      </Button>
    </span>
  );
}
