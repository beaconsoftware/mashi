"use client";

/**
 * L1 — interactive / generative tool-result components.
 *
 * Turns a read tool's result from a dead JSON disclosure into a control
 * surface: a board-item result renders as a live list whose rows the user can
 * open or act on (snooze, complete) inline, and a set_plan result renders as a
 * live checklist. Unmapped results return null so the caller falls back to the
 * I9 readable card (`ToolOutput`).
 *
 * Inline actions don't bypass the loop: they compose a natural-language turn
 * and dispatch it through the same `send` path a typed message takes, so every
 * action is governed by the exact ring + approval pipeline (ring-2 writes stay
 * undoable; a ring-3 action would still pause for approval). The component
 * never mutates anything directly.
 *
 * The shape-knowledge (which fields, which tools) lives in the pure, unit-tested
 * `provenance` module; this file is the render + dispatch layer only.
 */

import { Circle, CheckCircle2, Clock, ExternalLink, PanelRightOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  deriveActionableItems,
  derivePlanSteps,
  type ActionableItem,
} from "@/lib/agent/provenance";

export interface ToolResultViewHandlers {
  /** Dispatch a natural-language turn through the normal send pipeline. Absent
   * while a turn is streaming (the composer is locked), which disables the
   * inline write actions. */
  onAction?: (prompt: string) => void;
  /** Open a board item in its detail sheet. When absent, a row with an external
   * deep link still offers "Open" as a link; otherwise no open affordance. */
  onOpenItem?: (itemId: string) => void;
}

function ItemRow({
  item,
  handlers,
}: {
  item: ActionableItem;
  handlers: ToolResultViewHandlers;
}) {
  const { onAction, onOpenItem } = handlers;
  const meta = [item.priority, item.status].filter(Boolean).join(" · ");
  const name = `${item.ref}${item.ref === item.title ? "" : ` (${item.title})`}`;
  return (
    <li className="mashi-magnetic flex items-center gap-2 rounded-md border border-border/40 bg-card/55 px-2 py-1.5">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[11px] font-medium text-foreground">
          {item.ref !== item.title && (
            <span className="text-muted-foreground">{item.ref} · </span>
          )}
          {item.title}
        </span>
        {meta && (
          <span className="truncate text-[10px] text-muted-foreground">{meta}</span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {onOpenItem ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="mashi-press h-6 gap-1 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
            onClick={() => onOpenItem(item.id)}
          >
            <PanelRightOpen className="size-3" />
            Open
          </Button>
        ) : (
          item.href && (
            <a
              href={item.href}
              target="_blank"
              rel="noopener noreferrer"
              className="mashi-press inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
            >
              <ExternalLink className="size-3" />
              Open
            </a>
          )
        )}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={!onAction}
          className="mashi-press h-6 gap-1 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
          onClick={() =>
            onAction?.(`Snooze ${name} for a week.`)
          }
        >
          <Clock className="size-3" />
          Snooze 1w
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={!onAction}
          className="mashi-press h-6 gap-1 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
          onClick={() => onAction?.(`Mark ${name} as done.`)}
        >
          <CheckCircle2 className="size-3" />
          Done
        </Button>
      </div>
    </li>
  );
}

function InteractiveItemList({
  items,
  handlers,
}: {
  items: ActionableItem[];
  handlers: ToolResultViewHandlers;
}) {
  return (
    <ul className="space-y-1">
      {items.map((item) => (
        <ItemRow key={item.id} item={item} handlers={handlers} />
      ))}
    </ul>
  );
}

function PlanChecklist({ steps }: { steps: { text: string; checked: boolean }[] }) {
  const done = steps.filter((s) => s.checked).length;
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-medium text-foreground">
        Plan · {done}/{steps.length} done
      </p>
      <ul className="space-y-0.5">
        {steps.map((step, i) => (
          <li
            key={`${i}-${step.text}`}
            className="flex items-start gap-1.5 text-[11px]"
          >
            {step.checked ? (
              <CheckCircle2 className="mt-px size-3 shrink-0 text-emerald-500" />
            ) : (
              <Circle className="mt-px size-3 shrink-0 text-muted-foreground" />
            )}
            <span
              className={cn(
                "min-w-0",
                step.checked
                  ? "text-muted-foreground line-through"
                  : "text-foreground/90"
              )}
            >
              {step.text}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The interactive view for a tool result, or null when the result has no
 * actionable shape (caller falls back to the readable I9 card). `output` is the
 * already-parsed tool result.
 */
export function InteractiveToolView({
  toolName,
  output,
  handlers,
}: {
  toolName: string;
  output: unknown;
  handlers: ToolResultViewHandlers;
}) {
  const plan = derivePlanSteps(toolName, output);
  if (plan.length > 0) return <PlanChecklist steps={plan} />;

  const items = deriveActionableItems(toolName, output);
  if (items.length > 0)
    return <InteractiveItemList items={items} handlers={handlers} />;

  return null;
}

/** Whether a tool result has an interactive view, so the caller can decide to
 * open the card by default and skip the read-only summary. Pure + cheap. */
export function hasInteractiveToolView(
  toolName: string,
  output: unknown
): boolean {
  return (
    derivePlanSteps(toolName, output).length > 0 ||
    deriveActionableItems(toolName, output).length > 0
  );
}
