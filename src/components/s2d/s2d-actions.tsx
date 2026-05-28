"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Eye,
  Sun,
  SunDim,
  XCircle,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  PRIORITY_META,
  STATUS_META,
  STATUS_ORDER,
  type Priority,
  type S2DItem,
  type S2DStatus,
} from "@/types";
import { getPlannedState, todayIso } from "@/lib/planned";

export type BulkAction =
  | { kind: "plan-today" }
  | { kind: "plan-clear" }
  | { kind: "add-to-sprint" }
  | { kind: "move-to"; status: S2DStatus }
  | { kind: "set-priority"; priority: Priority }
  | { kind: "send-to-review" };

interface Props {
  /** Items currently selected. Used to compute eligibility (disabling
   * actions that are no-ops for the current set). */
  selected: S2DItem[];
  busy: boolean;
  onAction: (action: BulkAction) => void;
  onClear: () => void;
}

/**
 * Single Actions dropdown at the right of the toolbar. Disabled when
 * nothing is selected. Submenu structure mirrors the brief: planning
 * up top, then Move-to, Set-priority, Send-to-Review, Clear.
 *
 * Eligibility: an action is disabled when every selected item is
 * already in the target state, so the menu doesn't surface no-ops.
 */
export function S2DActionsDropdown({ selected, busy, onAction, onClear }: Props) {
  const count = selected.length;
  const hasSelection = count > 0;

  const today = todayIso();
  const allPlannedToday = hasSelection && selected.every((it) => it.planned_for === today);
  const nonePlanned = hasSelection && selected.every((it) => getPlannedState(it) == null);
  const allOnSprintToday =
    hasSelection && selected.every((it) => it.sprint_date === today);
  const allNeedsReview = hasSelection && selected.every((it) => it.needs_review === true);

  function eligibleForStatus(status: S2DStatus) {
    return !selected.every((it) => it.status === status && !it.needs_review);
  }
  function eligibleForPriority(p: Priority) {
    return !selected.every((it) => it.priority === p);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="sm"
          disabled={!hasSelection || busy}
          className="h-7 gap-1.5"
          title={
            hasSelection
              ? `Bulk actions for ${count} selected item${count === 1 ? "" : "s"}`
              : "Select items to enable bulk actions"
          }
        >
          {busy ? "Working…" : `Actions${hasSelection ? ` (${count})` : ""}`}
          <ChevronDown className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Planning
          </DropdownMenuLabel>
          <DropdownMenuItem
            disabled={allPlannedToday}
            onSelect={() => onAction({ kind: "plan-today" })}
            className="text-[12px]"
          >
            <Sun className="h-3.5 w-3.5" />
            Add to Today
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={nonePlanned}
            onSelect={() => onAction({ kind: "plan-clear" })}
            className="text-[12px]"
          >
            <SunDim className="h-3.5 w-3.5" />
            Remove from Today
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={allOnSprintToday}
            onSelect={() => onAction({ kind: "add-to-sprint" })}
            className="text-[12px]"
          >
            <Zap className="h-3.5 w-3.5" />
            Add to today&apos;s sprint
          </DropdownMenuItem>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="text-[12px]">
            Move to
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {STATUS_ORDER.map((s) => (
              <DropdownMenuItem
                key={s}
                disabled={!eligibleForStatus(s)}
                onSelect={() => onAction({ kind: "move-to", status: s })}
                className="text-[12px]"
              >
                {s === "done" && <CheckCircle2 className="h-3.5 w-3.5" />}
                {STATUS_META[s].label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="text-[12px]">
            Set priority
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {(Object.keys(PRIORITY_META) as Priority[]).map((p) => {
              const meta = PRIORITY_META[p];
              return (
                <DropdownMenuItem
                  key={p}
                  disabled={!eligibleForPriority(p)}
                  onSelect={() => onAction({ kind: "set-priority", priority: p })}
                  className="text-[12px]"
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: meta.color }}
                  />
                  {meta.label}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          disabled={allNeedsReview}
          onSelect={() => onAction({ kind: "send-to-review" })}
          className="text-[12px]"
        >
          <Eye className="h-3.5 w-3.5" />
          Send back to Review
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onClear} className="text-[12px]">
          <XCircle className="h-3.5 w-3.5" />
          Clear selection
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Patch shape applied to every item bulk-marked as Done. Centralized so
 * drag-to-Done and Actions → Move to → Done land the same data.
 */
export function buildDonePatch(): Partial<S2DItem> {
  return {
    status: "done",
    done_at: new Date().toISOString(),
    outcome: "Closed from board",
    resolved_via: "manual",
    queue_reason: null,
  };
}

export { AlertTriangle };
