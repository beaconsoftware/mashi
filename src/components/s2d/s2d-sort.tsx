"use client";

import { ArrowDownUp, ArrowUpAZ, ArrowDownAZ, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { S2DItem, Priority } from "@/types";

export type S2DSortMode =
  | "priority"
  | "updated"
  | "created"
  | "oldest"
  | "estimate";
export type S2DSortOrder = "asc" | "desc";

export interface S2DSortState {
  mode: S2DSortMode;
  order: S2DSortOrder;
}

export const DEFAULT_SORT: S2DSortState = { mode: "priority", order: "asc" };

const SORT_LABELS: Record<S2DSortMode, string> = {
  priority: "Priority",
  updated: "Recently updated",
  created: "Recently created",
  oldest: "Oldest open",
  estimate: "Estimate (shortest first)",
};

const VALID_SORT = new Set<S2DSortMode>([
  "priority",
  "updated",
  "created",
  "oldest",
  "estimate",
]);

type ReadonlyURLSearchParams = Pick<URLSearchParams, "get" | "toString">;

export function parseSortParams(
  searchParams: URLSearchParams | ReadonlyURLSearchParams
): S2DSortState {
  const m = searchParams.get("sort");
  const o = searchParams.get("order");
  const mode: S2DSortMode = VALID_SORT.has(m as S2DSortMode)
    ? (m as S2DSortMode)
    : DEFAULT_SORT.mode;
  const order: S2DSortOrder = o === "desc" ? "desc" : "asc";
  return { mode, order };
}

export function serializeSortParams(s: S2DSortState): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  if (s.mode !== DEFAULT_SORT.mode) out.push(["sort", s.mode]);
  if (s.order !== DEFAULT_SORT.order) out.push(["order", s.order]);
  return out;
}

export const SORT_PARAM_KEYS = ["sort", "order"] as const;

const PRIORITY_WEIGHT: Record<Priority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/**
 * Sort items by the chosen mode + order. `asc` matches the mode's label
 * direction; `desc` reverses. Within each mode, ties break on
 * `updated_at desc` (most-recent first) so within a priority bucket the
 * freshly-touched items rise.
 *
 * Estimate sort puts null `est_minutes` at the BOTTOM regardless of
 * order direction — an unestimated item is "we don't know how long this
 * takes" and shouldn't claim either end of the list.
 */
export function sortItems(
  items: S2DItem[],
  mode: S2DSortMode = DEFAULT_SORT.mode,
  order: S2DSortOrder = DEFAULT_SORT.order
): S2DItem[] {
  const arr = [...items];
  const tieBreak = (a: S2DItem, b: S2DItem) => b.updated_at.localeCompare(a.updated_at);

  switch (mode) {
    case "priority":
      arr.sort((a, b) => {
        const w = PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority];
        if (w !== 0) return w;
        return tieBreak(a, b);
      });
      break;
    case "updated":
      arr.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      break;
    case "created":
      arr.sort((a, b) => b.created_at.localeCompare(a.created_at));
      break;
    case "oldest":
      arr.sort((a, b) => {
        const c = a.created_at.localeCompare(b.created_at);
        if (c !== 0) return c;
        return tieBreak(a, b);
      });
      break;
    case "estimate":
      arr.sort((a, b) => {
        const aHas = a.est_minutes != null;
        const bHas = b.est_minutes != null;
        if (aHas && !bHas) return -1;
        if (!aHas && bHas) return 1;
        if (!aHas && !bHas) return tieBreak(a, b);
        const d = (a.est_minutes ?? 0) - (b.est_minutes ?? 0);
        if (d !== 0) return d;
        return tieBreak(a, b);
      });
      break;
  }

  if (order === "desc") {
    // Reverse, but keep nulls (for estimate mode) at the bottom.
    if (mode === "estimate") {
      const withEst = arr.filter((it) => it.est_minutes != null).reverse();
      const withoutEst = arr.filter((it) => it.est_minutes == null);
      return [...withEst, ...withoutEst];
    }
    arr.reverse();
  }
  return arr;
}

export function S2DSortDropdown({
  state,
  setState,
}: {
  state: S2DSortState;
  setState: (next: S2DSortState) => void;
}) {
  const label = SORT_LABELS[state.mode];
  const OrderIcon = state.order === "asc" ? ArrowUpAZ : ArrowDownAZ;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 text-[11px]"
        >
          <ArrowDownUp className="h-3 w-3" />
          Sort: {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Sort by
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={state.mode}
          onValueChange={(v) => setState({ ...state, mode: v as S2DSortMode })}
        >
          {(Object.keys(SORT_LABELS) as S2DSortMode[]).map((m) => (
            <DropdownMenuRadioItem key={m} value={m} className="text-[12px]">
              {SORT_LABELS[m]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            setState({ ...state, order: state.order === "asc" ? "desc" : "asc" });
          }}
          className="text-[12px]"
        >
          <OrderIcon className="h-3.5 w-3.5" />
          <span className="flex-1">
            {state.order === "asc" ? "Ascending" : "Descending"}
          </span>
          <Check className="h-3 w-3 opacity-60" />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
