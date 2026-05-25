"use client";

import { useMemo } from "react";
import { X, Filter, Sun, AlertCircle } from "lucide-react";
import { useCompanies } from "@/hooks/use-s2d";
import {
  PATHWAY_META,
  PRIORITY_META,
  type Pathway,
  type Priority,
  type S2DItem,
} from "@/types";
import { cn } from "@/lib/utils";
import { ChromeBar } from "@/components/layout/primitives";
import { Button } from "@/components/ui/button";
import { getPlannedState } from "@/lib/planned";

export type PlannedFilter = "today" | "overdue";

export interface S2DFilterState {
  companies: Set<string>;
  pathways: Set<Pathway>;
  priorities: Set<Priority>;
  planned: Set<PlannedFilter>;
}

export const EMPTY_FILTER: S2DFilterState = {
  companies: new Set(),
  pathways: new Set(),
  priorities: new Set(),
  planned: new Set(),
};

/**
 * URL param keys used by the filter. Exported so consumers (e.g.
 * S2DBoard's setFilters) can strip them before re-serializing.
 */
export const FILTER_PARAM_KEYS = ["company", "pathway", "priority", "planned"] as const;

const VALID_PATHWAYS = new Set(Object.keys(PATHWAY_META) as Pathway[]);
const VALID_PRIORITIES = new Set(Object.keys(PRIORITY_META) as Priority[]);
const VALID_PLANNED = new Set<PlannedFilter>(["today", "overdue"]);

/**
 * Read filter state from URL search params. Each dimension serialized as a
 * comma-separated list under its own key (?company=a,b&pathway=quick_reply).
 * Unknown values are silently dropped (no point in remembering invalid state).
 */
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
    planned: new Set(
      [...read("planned")].filter((p): p is PlannedFilter =>
        VALID_PLANNED.has(p as PlannedFilter)
      )
    ),
  };
}

/**
 * Serialize filter state back to URL params. Returns an array of
 * [key, value] pairs so the caller can merge with existing params
 * without clobbering unrelated ones.
 */
export function serializeFilterParams(s: S2DFilterState): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  if (s.companies.size > 0) out.push(["company", [...s.companies].join(",")]);
  if (s.pathways.size > 0) out.push(["pathway", [...s.pathways].join(",")]);
  if (s.priorities.size > 0) out.push(["priority", [...s.priorities].join(",")]);
  if (s.planned.size > 0) out.push(["planned", [...s.planned].join(",")]);
  return out;
}

// next/navigation's ReadonlyURLSearchParams shape — declared locally so this
// file doesn't need to import the framework just for a type.
type ReadonlyURLSearchParams = Pick<URLSearchParams, "get" | "toString">;

/**
 * Apply current filter state to an items array. Empty sets in a dimension
 * mean "all" — so a filter with nothing selected returns everything.
 */
export function applyS2DFilters(
  items: S2DItem[],
  f: S2DFilterState
): S2DItem[] {
  return items.filter((it) => {
    if (
      f.companies.size > 0 &&
      (!it.company_id || !f.companies.has(it.company_id))
    )
      return false;
    if (f.pathways.size > 0 && !f.pathways.has(it.pathway)) return false;
    if (f.priorities.size > 0 && !f.priorities.has(it.priority)) return false;
    if (f.planned.size > 0) {
      const state = getPlannedState(it);
      // null state (not planned, or done, or older than yesterday) never matches.
      if (!state || !f.planned.has(state)) return false;
    }
    return true;
  });
}

/**
 * Filter bar that sits above the S2D board. All chips are multi-select
 * toggles. Active selections are highlighted; clicking again removes
 * that value. A "Clear all" chip appears when any filter is active.
 *
 * State is owned by the parent (S2DBoard) so it can be shared with the
 * filtered items pipeline + a future "save view" feature.
 */
export function S2DFilters({
  state,
  setState,
  totalCount,
  filteredCount,
}: {
  state: S2DFilterState;
  setState: (next: S2DFilterState) => void;
  totalCount: number;
  filteredCount: number;
}) {
  const { data: companies = [] } = useCompanies();

  const anyActive =
    state.companies.size > 0 ||
    state.pathways.size > 0 ||
    state.priorities.size > 0 ||
    state.planned.size > 0;

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
  function togglePlanned(p: PlannedFilter) {
    const next = new Set(state.planned);
    if (next.has(p)) next.delete(p);
    else next.add(p);
    setState({ ...state, planned: next });
  }
  function clearAll() {
    setState(EMPTY_FILTER);
  }

  // Sort companies by name once
  const sortedCompanies = useMemo(
    () => [...companies].sort((a, b) => a.name.localeCompare(b.name)),
    [companies]
  );

  return (
    <ChromeBar className="flex flex-wrap items-center gap-1.5 border-border/30 px-4 py-2 text-[11px]">
      <Filter className="h-3 w-3 text-muted-foreground" />

      {/* Planned — daily-focus filter; pairs with the TODAY / OVERDUE
          badges on cards so the user can see "just what I committed to
          today" in one click. */}
      <ChipGroup label="Planned">
        <Chip
          active={state.planned.has("today")}
          onClick={() => togglePlanned("today")}
        >
          <Sun aria-hidden className="h-2.5 w-2.5" />
          Today
        </Chip>
        <Chip
          active={state.planned.has("overdue")}
          onClick={() => togglePlanned("overdue")}
        >
          <AlertCircle aria-hidden className="h-2.5 w-2.5" />
          Overdue
        </Chip>
      </ChipGroup>

      <Divider />

      {/* Companies */}
      <ChipGroup label="Company">
        {sortedCompanies.map((c) => {
          const on = state.companies.has(c.id);
          return (
            <Chip
              key={c.id}
              active={on}
              onClick={() => toggleCompany(c.id)}
              accent={c.color_hex}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: c.color_hex }}
              />
              {c.name}
            </Chip>
          );
        })}
      </ChipGroup>

      <Divider />

      {/* Action types (internally still called pathway in the schema) */}
      <ChipGroup label="Action type">
        {(Object.keys(PATHWAY_META) as Pathway[]).map((p) => {
          const meta = PATHWAY_META[p];
          const on = state.pathways.has(p);
          return (
            <Chip key={p} active={on} onClick={() => togglePathway(p)}>
              <span className="text-[10px]">{meta.icon}</span>
              {meta.shortLabel}
            </Chip>
          );
        })}
      </ChipGroup>

      <Divider />

      {/* Priority */}
      <ChipGroup label="Priority">
        {(Object.keys(PRIORITY_META) as Priority[]).map((p) => {
          const meta = PRIORITY_META[p];
          const on = state.priorities.has(p);
          return (
            <Chip
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
            </Chip>
          );
        })}
      </ChipGroup>

      {anyActive && (
        <>
          <Divider />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={clearAll}
            className="inline-flex h-auto items-center gap-1 rounded-full border border-border/40 px-2 py-0.5 text-[11px] font-normal text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-2.5 w-2.5" />
            Clear
          </Button>
        </>
      )}

      <span className="ml-auto font-mono text-[10px] text-muted-foreground tabular-nums">
        {anyActive ? `${filteredCount} / ${totalCount}` : `${totalCount} items`}
      </span>
    </ChromeBar>
  );
}

function ChipGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

function Divider() {
  return <span className="mx-1 h-3 w-px bg-border/40" />;
}

function Chip({
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
