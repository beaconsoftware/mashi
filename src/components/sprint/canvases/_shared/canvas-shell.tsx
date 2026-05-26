"use client";

import { useState, type ReactNode } from "react";
import {
  Loader2,
  SkipForward,
  ArchiveRestore,
  Clock,
  ExternalLink,
  Sparkles,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { SectionHeader } from "@/components/layout/primitives";
import { PathwayBadge } from "@/components/shared/pathway-badge";
import { PriorityDot } from "@/components/shared/priority-dot";
import { cn } from "@/lib/utils";
import { useRefineSheet } from "@/store/refine-sheet-store";
import type { S2DItem, Pathway } from "@/types";

/**
 * Shared chrome for every pathway canvas: identity strip header + a
 * sticky footer with the canvas's primary action plus the standard
 * Skip / Bench / Snooze / Detail / Refine secondaries.
 *
 * The canvases themselves render INSIDE this shell — they own the
 * middle scroll region. Header and footer are stable across pathways
 * so the user's hands and eyes don't relocate per slot.
 */

export type SlotExit =
  | { kind: "done"; outcome?: string }
  | { kind: "skip" }
  | { kind: "bench" }
  | { kind: "snooze"; until: string }
  | {
      kind: "send";
      channel: "gmail" | "slack";
      body: string;
      spawnsWatchItem: boolean;
    }
  | {
      kind: "decide";
      choice: "yes" | "yes-but" | "no" | "defer";
      note: string;
      condition?: string;
      deferUntil?: string;
    }
  | { kind: "check-in"; note?: string; continue: boolean }
  | { kind: "stage-meeting"; calendarEventId: string; talkingPoints: string }
  | { kind: "nudge-delegate"; channel: "gmail" | "slack"; body: string }
  | { kind: "repathway"; newPathway: Pathway };

export interface PrewarmState {
  status: "pending" | "warming" | "ready" | "skipped" | "failed";
  error?: string;
  completedAt?: string;
}

export interface CanvasBaseProps {
  item: S2DItem;
  active: boolean;
  prewarm: PrewarmState;
  onExit: (exit: SlotExit) => Promise<void> | void;
  onOpenDetail?: () => void;
}

interface CanvasShellProps extends CanvasBaseProps {
  children: ReactNode;
  /** The pathway-specific primary action button. */
  primary?: ReactNode;
  /**
   * When true (default), the footer renders the full secondary action
   * row (Snooze / Skip / Bench / Refine / Detail). Slot cards in the
   * sprint multi-active mode pass `compact` so the row collapses to
   * just the primary action + Refine — the slot card chrome already
   * owns Skip / Bench / Snooze / Detail. Phases 3+ extend this for
   * other use cases.
   */
  footerVariant?: "full" | "compact";
}

export function CanvasShell({
  item,
  prewarm,
  onExit,
  onOpenDetail,
  children,
  primary,
  footerVariant = "full",
}: CanvasShellProps) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <CanvasHeader item={item} prewarm={prewarm} />
      <div className="flex-1 min-h-0 overflow-y-auto p-3">{children}</div>
      <CanvasFooter
        primary={primary}
        onExit={onExit}
        onOpenDetail={onOpenDetail}
        itemId={item.id}
        variant={footerVariant}
      />
    </div>
  );
}

function CanvasHeader({ item, prewarm }: { item: S2DItem; prewarm: PrewarmState }) {
  return (
    <SectionHeader as="header" className="flex-col items-stretch !py-2.5">
      <div className="flex w-full items-center gap-2">
        <PathwayBadge pathway={item.pathway} compact />
        <PriorityDot priority={item.priority} />
        {item.company && (
          <span className="truncate text-[11px] normal-case tracking-normal text-foreground/80">
            {item.company.name}
          </span>
        )}
        <span className="font-mono text-[10px] normal-case tracking-normal text-muted-foreground">
          MASH-{item.ticket_number}
        </span>
        <PrewarmIndicator prewarm={prewarm} />
      </div>
      <h3 className="mt-1 w-full text-balance text-sm font-semibold normal-case leading-snug tracking-normal text-foreground">
        {item.title}
      </h3>
    </SectionHeader>
  );
}

function PrewarmIndicator({ prewarm }: { prewarm: PrewarmState }) {
  if (prewarm.status === "warming") {
    return (
      <span className="ml-auto inline-flex items-center gap-1 rounded bg-primary/15 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-primary">
        <Loader2 className="h-2.5 w-2.5 animate-spin" />
        warming
      </span>
    );
  }
  if (prewarm.status === "ready") {
    return (
      <span className="ml-auto inline-flex items-center gap-1 rounded bg-primary/15 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-primary">
        <Sparkles className="h-2.5 w-2.5" />
        ready
      </span>
    );
  }
  if (prewarm.status === "failed") {
    return (
      <span
        className="ml-auto rounded bg-destructive/15 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-destructive"
        title={prewarm.error}
      >
        warm failed
      </span>
    );
  }
  return null;
}

function CanvasFooter({
  primary,
  onExit,
  onOpenDetail,
  itemId,
  variant,
}: {
  primary: ReactNode;
  onExit: (e: SlotExit) => Promise<void> | void;
  onOpenDetail?: () => void;
  itemId: string;
  variant: "full" | "compact";
}) {
  const openRefine = useRefineSheet((s) => s.openFor);
  return (
    <div className="flex shrink-0 items-center gap-1.5 border-t border-border/40 bg-card/55 px-3 py-2">
      <div className="flex-1">{primary}</div>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => openRefine(itemId)}
        className="mashi-press h-7 gap-1 px-2 text-[11px] text-muted-foreground"
        title="Refine — chat with the agent about this item (⌥+R or /)"
      >
        <Wand2 className="h-3 w-3" />
        Refine
      </Button>
      {variant === "full" && (
        <>
          <SnoozePopover onExit={onExit} />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => onExit({ kind: "skip" })}
            className="mashi-press h-7 gap-1 px-2 text-[11px] text-muted-foreground"
            title="Skip — remove from sprint, leave the s2d item alone"
          >
            <SkipForward className="h-3 w-3" />
            Skip
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => onExit({ kind: "bench" })}
            className="mashi-press h-7 gap-1 px-2 text-[11px] text-muted-foreground"
            title="Bench — keep item active, move out of this sprint"
          >
            <ArchiveRestore className="h-3 w-3" />
            Bench
          </Button>
          {onOpenDetail && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={onOpenDetail}
              className="mashi-press h-7 gap-1 px-2 text-[11px] text-muted-foreground"
              title="Open full detail (⌘+.)"
            >
              <ExternalLink className="h-3 w-3" />
              Detail
            </Button>
          )}
        </>
      )}
    </div>
  );
}

function SnoozePopover({ onExit }: { onExit: (e: SlotExit) => Promise<void> | void }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  });
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className={cn(
            "mashi-press h-7 gap-1 px-2 text-[11px] text-muted-foreground"
          )}
          title="Snooze — defer to a chosen date"
        >
          <Clock className="h-3 w-3" />
          Snooze
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        className="z-dropdown w-[220px] space-y-2 p-3"
      >
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Snooze until
        </div>
        <Input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="h-7 text-[11px]"
        />
        <Button
          type="button"
          size="sm"
          onClick={() => {
            const iso = new Date(`${date}T00:00:00`).toISOString();
            onExit({ kind: "snooze", until: iso });
            setOpen(false);
          }}
          className="h-7 w-full text-[11px]"
        >
          Snooze
        </Button>
      </PopoverContent>
    </Popover>
  );
}
