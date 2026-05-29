"use client";

import { createContext, useContext, useState } from "react";
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
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
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
 * Eligibility helpers used by both menu surfaces. An action is hidden
 * (well, disabled — Radix grays out the row but doesn't unmount it,
 * which preserves keyboard navigation predictability) when every
 * selected item is already in the target state. No-ops shouldn't appear
 * live.
 */
function computeEligibility(selected: S2DItem[]) {
  const count = selected.length;
  const hasSelection = count > 0;
  const today = todayIso();
  return {
    count,
    hasSelection,
    allPlannedToday:
      hasSelection && selected.every((it) => it.planned_for === today),
    nonePlanned:
      hasSelection && selected.every((it) => getPlannedState(it) == null),
    allOnSprintToday:
      hasSelection && selected.every((it) => it.sprint_date === today),
    allNeedsReview:
      hasSelection && selected.every((it) => it.needs_review === true),
    eligibleForStatus: (status: S2DStatus) =>
      !selected.every((it) => it.status === status && !it.needs_review),
    eligibleForPriority: (p: Priority) =>
      !selected.every((it) => it.priority === p),
  };
}

/**
 * Primitive set shared by both the toolbar DropdownMenu and the card
 * ContextMenu. Radix exposes the same component shapes under both
 * trees, so we render a single menu body parametrized by which set to
 * use. Keeps the structure + eligibility logic single-sourced; only the
 * outer trigger/content shell differs.
 */
interface MenuPrimitives {
  Group: React.ComponentType<{ children: React.ReactNode }>;
  Item: React.ComponentType<{
    children: React.ReactNode;
    disabled?: boolean;
    onSelect: (event: Event) => void;
    className?: string;
  }>;
  Label: React.ComponentType<{
    children: React.ReactNode;
    className?: string;
  }>;
  Separator: React.ComponentType<Record<string, never>>;
  Sub: React.ComponentType<{ children: React.ReactNode }>;
  SubTrigger: React.ComponentType<{
    children: React.ReactNode;
    className?: string;
  }>;
  SubContent: React.ComponentType<{ children: React.ReactNode }>;
}

const DROPDOWN_PRIMITIVES: MenuPrimitives = {
  Group: DropdownMenuGroup,
  Item: DropdownMenuItem,
  Label: DropdownMenuLabel,
  Separator: DropdownMenuSeparator,
  Sub: DropdownMenuSub,
  SubTrigger: DropdownMenuSubTrigger,
  SubContent: DropdownMenuSubContent,
};

const CONTEXT_PRIMITIVES: MenuPrimitives = {
  Group: ContextMenuGroup,
  Item: ContextMenuItem,
  Label: ContextMenuLabel,
  Separator: ContextMenuSeparator,
  Sub: ContextMenuSub,
  SubTrigger: ContextMenuSubTrigger,
  SubContent: ContextMenuSubContent,
};

function ActionsMenuBody({
  selected,
  onAction,
  onClear,
  P,
}: {
  selected: S2DItem[];
  onAction: (action: BulkAction) => void;
  onClear: () => void;
  P: MenuPrimitives;
}) {
  const e = computeEligibility(selected);

  return (
    <>
      <P.Group>
        <P.Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Planning
        </P.Label>
        <P.Item
          disabled={e.allPlannedToday}
          onSelect={() => onAction({ kind: "plan-today" })}
          className="text-[12px]"
        >
          <Sun className="h-3.5 w-3.5" />
          Add to Today
        </P.Item>
        <P.Item
          disabled={e.nonePlanned}
          onSelect={() => onAction({ kind: "plan-clear" })}
          className="text-[12px]"
        >
          <SunDim className="h-3.5 w-3.5" />
          Remove from Today
        </P.Item>
        <P.Item
          disabled={e.allOnSprintToday}
          onSelect={() => onAction({ kind: "add-to-sprint" })}
          className="text-[12px]"
        >
          <Zap className="h-3.5 w-3.5" />
          Add to today&apos;s sprint
        </P.Item>
      </P.Group>

      <P.Separator />

      <P.Sub>
        <P.SubTrigger className="text-[12px]">Move to</P.SubTrigger>
        <P.SubContent>
          {STATUS_ORDER.map((s) => (
            <P.Item
              key={s}
              disabled={!e.eligibleForStatus(s)}
              onSelect={() => onAction({ kind: "move-to", status: s })}
              className="text-[12px]"
            >
              {s === "done" && <CheckCircle2 className="h-3.5 w-3.5" />}
              {STATUS_META[s].label}
            </P.Item>
          ))}
        </P.SubContent>
      </P.Sub>

      <P.Sub>
        <P.SubTrigger className="text-[12px]">Set priority</P.SubTrigger>
        <P.SubContent>
          {(Object.keys(PRIORITY_META) as Priority[]).map((p) => {
            const meta = PRIORITY_META[p];
            return (
              <P.Item
                key={p}
                disabled={!e.eligibleForPriority(p)}
                onSelect={() => onAction({ kind: "set-priority", priority: p })}
                className="text-[12px]"
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: meta.color }}
                />
                {meta.label}
              </P.Item>
            );
          })}
        </P.SubContent>
      </P.Sub>

      <P.Separator />

      <P.Item
        disabled={e.allNeedsReview}
        onSelect={() => onAction({ kind: "send-to-review" })}
        className="text-[12px]"
      >
        <Eye className="h-3.5 w-3.5" />
        Send back to Review
      </P.Item>
      <P.Item onSelect={onClear} className="text-[12px]">
        <XCircle className="h-3.5 w-3.5" />
        Clear selection
      </P.Item>
    </>
  );
}

/**
 * Single Actions dropdown at the right of the toolbar. Disabled when
 * nothing is selected. Submenu structure mirrors the brief: planning
 * up top, then Move-to, Set-priority, Send-to-Review, Clear.
 *
 * Shares its menu body with `<S2DActionsContextMenu>` — both render
 * `ActionsMenuBody` parametrized by primitive set.
 */
export function S2DActionsDropdown({ selected, busy, onAction, onClear }: Props) {
  const { count, hasSelection } = computeEligibility(selected);

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
        <ActionsMenuBody
          selected={selected}
          onAction={onAction}
          onClear={onClear}
          P={DROPDOWN_PRIMITIVES}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Right-click context menu for a single S2D item (card or list row).
 *
 * Wraps its children in a `<ContextMenuTrigger>`. The parent is
 * responsible for resolving "what's selected when this opens":
 *   - If the right-clicked item IS in the current multi-select, pass the
 *     full selection so the menu acts on all of them (Finder behavior).
 *   - If it is NOT in the multi-select, pass just `[item]` so the menu
 *     scopes to the one card without disturbing the larger selection.
 *
 * The caller controls that decision via the `onOpen` callback, which
 * receives the right-clicked item and returns the effective selection.
 * We use it to keep the menu predictable: right-clicking a card always
 * acts on that card at minimum, even if the user forgot to multi-select.
 */
export function S2DActionsContextMenu({
  item,
  resolveSelection,
  onAction,
  onClear,
  children,
}: {
  item: S2DItem;
  /** Called when the menu opens. Returns the effective S2DItem[] the
   * menu should act on. Lives in s2d-board.tsx so it can read the full
   * selection store + decide "scope to selection" vs "scope to this
   * one card". */
  resolveSelection: (rightClickedItem: S2DItem) => S2DItem[];
  onAction: (action: BulkAction, scoped: S2DItem[]) => void;
  onClear: () => void;
  children: React.ReactNode;
}) {
  // The scoped selection at the moment of opening. Captured so a
  // mid-menu selection change in the store doesn't yank the rug; the
  // user clicked with a specific scope in mind.
  const [scoped, setScoped] = useState<S2DItem[]>([item]);

  return (
    <ContextMenu
      onOpenChange={(open) => {
        if (open) setScoped(resolveSelection(item));
      }}
    >
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ActionsMenuBody
          selected={scoped}
          onAction={(a) => onAction(a, scoped)}
          onClear={onClear}
          P={CONTEXT_PRIMITIVES}
        />
      </ContextMenuContent>
    </ContextMenu>
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

/**
 * Context shared between the toolbar's Actions dropdown and every
 * card's right-click context menu. The board owns the dispatcher
 * (S2DBoard's handleBulkAction), the store, and the selection-scope
 * resolution. Cards just consume.
 *
 * Stays optional (null default) so a S2DItemCard rendered outside a
 * board context — like the dnd-kit DragOverlay preview — doesn't get a
 * right-click menu it can't act on.
 */
export interface S2DActionsContextValue {
  /** Apply a bulk action to a specific S2DItem[] (the scoped selection
   * resolved by the context menu at open time). */
  runAction: (action: BulkAction, scoped: S2DItem[]) => void;
  clearSelection: () => void;
  /** Given the item the user right-clicked, return the effective set
   * the menu should act on: full multi-selection if the clicked item
   * is part of it, otherwise just the clicked item. Implemented by the
   * board because it reads the store. */
  resolveSelection: (item: S2DItem) => S2DItem[];
}

const S2DActionsCtx = createContext<S2DActionsContextValue | null>(null);

export function S2DActionsProvider({
  value,
  children,
}: {
  value: S2DActionsContextValue;
  children: React.ReactNode;
}) {
  return <S2DActionsCtx.Provider value={value}>{children}</S2DActionsCtx.Provider>;
}

export function useS2DActions(): S2DActionsContextValue | null {
  return useContext(S2DActionsCtx);
}
