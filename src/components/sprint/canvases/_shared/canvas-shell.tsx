"use client";

import { forwardRef, useState, type ReactNode } from "react";
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
import { RepathwayPopover } from "@/components/sprint/repathway-popover";
import { useSprintStore } from "@/store/sprint-store";
import { PATHWAY_META } from "@/types";
import { cn } from "@/lib/utils";
import { useAgentThread } from "@/store/agent-thread-store";
import { useEnrichedContext } from "@/hooks/use-enriched-context";
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
  /**
   * When true, the footer hides the "Ask Mashi" / Refine chip. Used by
   * surfaces (Phase 8 Focus card) that already host the persistent
   * thread inline, so the chip would just summon a redundant sheet.
   */
  hideRefine?: boolean;
  /**
   * When true, suppress the canvas footer entirely (no primary button,
   * no secondary row). Use when the enclosing chrome (e.g. the
   * `<SlotCard>` Done/Skip/Bench/Snooze row) already owns the action
   * surface and a canvas footer would double up. Focus card sets this.
   */
  hideFooter?: boolean;
}

export const CanvasShell = forwardRef<HTMLDivElement, CanvasShellProps>(
  function CanvasShell(
    {
      item,
      prewarm,
      onExit,
      onOpenDetail,
      children,
      primary,
      footerVariant = "full",
      hideRefine = false,
      hideFooter = false,
    },
    ref
  ) {
    const meta = PATHWAY_META[item.pathway];
    // Phase 6: compose the ambient album tint over a faint pathway hue
    // over the canonical card translucency. The tint is set by
    // SpotifyAmbientBg as --sprint-card-tint when an album is playing;
    // when absent the gradient falls back to a transparent stop so the
    // pathway hue + card surface remain unchanged. Text uses
    // text-foreground only (header / footer / children) — never custom
    // colors — to keep contrast guarantees across tinted backdrops.
    const style: React.CSSProperties = {
      backgroundImage: `linear-gradient(var(--sprint-card-tint, transparent), var(--sprint-card-tint, transparent)), linear-gradient(180deg, hsl(var(${meta.colorVar}) / 0.04) 0%, transparent 60%)`,
    };
    return (
      <div
        ref={ref}
        // `flex-1 min-h-0` (not `h-full`) so the canvas plays nice when
        // a parent flex-col adds a sibling footer below (e.g. the
        // `<SlotCard>` Done/Skip/Bench/Snooze row). With h-full both the
        // canvas and the slot footer would compete for 100% of the
        // parent height and the slot footer would clip on tall content.
        className="relative flex flex-1 min-h-0 flex-col overflow-hidden"
        style={style}
      >
        <CanvasHeader item={item} prewarm={prewarm} />
        <div className="flex-1 min-h-0 overflow-y-auto p-3">{children}</div>
        {!hideFooter && (
          <CanvasFooter
            primary={primary}
            onExit={onExit}
            onOpenDetail={onOpenDetail}
            itemId={item.id}
            variant={footerVariant}
            hideRefine={hideRefine}
          />
        )}
      </div>
    );
  }
);

function CanvasHeader({ item, prewarm }: { item: S2DItem; prewarm: PrewarmState }) {
  const block = useSprintStore((s) =>
    s.blocks.find((b) => b.s2dItemId === item.id)
  );
  // Phase 6: surface the persistent thread's rolling summary one-liner
  // under the title so the user knows the agent has memory of prior
  // turns before they open Ask Mashi. Stashed at pre-warm time on
  // enriched_context.thread_summary; null when no thread or no
  // summary has been compacted yet.
  const enrich = useEnrichedContext(item.id);
  const threadSummary = enrich.data?.enriched_context?.thread_summary?.text;
  return (
    <SectionHeader as="header" className="flex-col items-stretch !py-2.5">
      <div className="flex w-full items-center gap-2">
        {/* Phase 6: PathwayBadge becomes a re-pathway trigger. Clicking
            opens the popover; selecting an alternative runs the canvas
            morph + persists the new pathway. */}
        <RepathwayPopover item={item} block={block}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mashi-press h-auto rounded p-0.5 hover:bg-secondary/60"
            aria-label={`Change pathway from ${item.pathway}`}
            title="Re-pathway this item"
          >
            <PathwayBadge pathway={item.pathway} compact />
          </Button>
        </RepathwayPopover>
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
      {threadSummary && (
        <p
          className="mt-0.5 line-clamp-2 w-full text-[11px] italic normal-case tracking-normal text-muted-foreground"
          title={threadSummary}
        >
          Last conversation: {firstSentence(threadSummary)}
        </p>
      )}
    </SectionHeader>
  );
}

/** Trim a multi-bullet rolling summary down to its first meaningful
 *  sentence (or first bullet) for the title-row one-liner. Keeps the
 *  canvas chrome compact while still surfacing concrete content. */
function firstSentence(s: string): string {
  const trimmed = s.trim();
  if (!trimmed) return "";
  // Strip a leading "- " / "* " / "• " bullet marker.
  const stripped = trimmed.replace(/^[\-\*•]\s+/, "");
  const firstLine = stripped.split(/\n/)[0]?.trim() ?? stripped;
  const sentence = firstLine.split(/(?<=[.!?])\s/)[0] ?? firstLine;
  if (sentence.length <= 160) return sentence;
  return `${sentence.slice(0, 157)}...`;
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
  hideRefine,
}: {
  primary: ReactNode;
  onExit: (e: SlotExit) => Promise<void> | void;
  onOpenDetail?: () => void;
  itemId: string;
  variant: "full" | "compact";
  hideRefine: boolean;
}) {
  // Phase 2 of the agent buildout: the Refine chip now opens the
  // persistent agent thread for the item, not the legacy
  // per-sprint enriched_context.thread. One thread per item, across
  // sprints, across surfaces — see AGENTS.md and the agent buildout doc.
  const openAgent = useAgentThread((s) => s.openFor);
  return (
    <div className="flex shrink-0 items-center gap-1.5 border-t border-border/40 bg-card/55 px-3 py-2">
      <div className="flex-1">{primary}</div>
      {!hideRefine && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => openAgent(itemId)}
          className="mashi-press h-7 gap-1 px-2 text-[11px] text-muted-foreground"
          title="Ask Mashi — open the persistent thread for this item (⌥+R or /)"
        >
          <Wand2 className="h-3 w-3" />
          Ask Mashi
        </Button>
      )}
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
