"use client";

import { useState, type ReactNode, type RefObject } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import {
  useUpdateS2DItem,
} from "@/hooks/use-s2d";
import { useSprintStore, type SprintBlock } from "@/store/sprint-store";
import { morphIn, morphOut } from "@/lib/sprint/canvas-morph";
import { PATHWAY_META, type Pathway, type S2DItem } from "@/types";
import { cn } from "@/lib/utils";

interface RepathwayPopoverProps {
  item: S2DItem;
  block?: SprintBlock;
  /**
   * Element whose contents should fade out → in across the change.
   * Passing the slot card's outer ref produces the morph effect spec'd
   * in Phase 6.
   */
  morphTargetRef?: RefObject<HTMLElement | null>;
  /**
   * Optional restriction set. WatchCanvas passes [quick_reply,
   * decision_gate] to express "promote to action" semantics. When
   * omitted, all 6 alternatives appear (the current pathway is always
   * filtered out).
   */
  allowed?: Pathway[];
  /** Fires after the new pathway is persisted. Used by the watch canvas
   * to also fire its slot exit. */
  onChanged?: (newPathway: Pathway) => void;
  children: ReactNode;
}

const ALL_PATHWAYS: Pathway[] = [
  "quick_reply",
  "drafted_response",
  "decision_gate",
  "heads_down",
  "meeting_backed",
  "delegated",
  "watching",
];

/**
 * Re-pathway popover: lists 6 alternatives with glyph + label + 1-line
 * description. Selecting one runs the morph timeline from
 * `@/lib/sprint/canvas-morph`, PATCHes the s2d_item, and re-warms the
 * canvas so the user lands on the new shape without an unmount flash.
 *
 * The morph is driven by `morphTargetRef` — when present, the canvas
 * fades out (morphOut), the mutation runs, then fades in (morphIn).
 * When absent (e.g. nested in popovers that own their own animation),
 * the change happens without the morph.
 */
export function RepathwayPopover({
  item,
  block,
  morphTargetRef,
  allowed,
  onChanged,
  children,
}: RepathwayPopoverProps) {
  const [open, setOpen] = useState(false);
  const updateItem = useUpdateS2DItem();
  const setPrewarm = useSprintStore((s) => s.setPrewarm);

  const choices = (allowed ?? ALL_PATHWAYS).filter((p) => p !== item.pathway);

  async function pick(newPathway: Pathway) {
    setOpen(false);
    const target = morphTargetRef?.current ?? null;
    await morphOut(target);
    try {
      await updateItem.mutateAsync({ id: item.id, patch: { pathway: newPathway } });
    } catch {
      // Best-effort: still try to fade back in so the user isn't stuck
      // on a dimmed canvas. The mutation's onError already rolls back
      // the optimistic cache update.
      await morphIn(target);
      return;
    }
    // Clear prewarm state for the new pathway so the scheduler refires.
    if (block) {
      setPrewarm(item.id, {
        prewarm_status: "pending",
        prewarm_completed_at: null,
        prewarm_error: null,
        prewarm_queued_soon_fired: false,
      });
      try {
        const { schedulePrewarmDebounced } = await import(
          "@/lib/sprint/prewarm-scheduler"
        );
        schedulePrewarmDebounced({
          block: { ...block, prewarm_status: "pending" },
          item: { ...item, pathway: newPathway },
          reason: "repathway",
        });
      } catch {
        // Scheduler load failed — non-fatal; the canvas will still
        // render in its empty state.
      }
    }
    await morphIn(target);
    onChanged?.(newPathway);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={4}
        className="z-dropdown w-[320px] p-1"
      >
        <div className="px-2 pb-1.5 pt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
          Re-pathway
        </div>
        <div className="space-y-0.5">
          {choices.map((p) => {
            const meta = PATHWAY_META[p];
            return (
              <Button
                key={p}
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => pick(p)}
                className={cn(
                  "mashi-press h-auto w-full justify-start gap-2 rounded px-2 py-1.5 text-left hover:bg-secondary/60"
                )}
              >
                <span
                  className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[12px]"
                  style={{ color: `hsl(var(${meta.colorVar}))` }}
                  aria-hidden
                >
                  {meta.icon}
                </span>
                <span className="flex flex-col">
                  <span className="text-[12px] font-medium text-foreground">
                    {meta.label}
                  </span>
                  <span className="text-[10px] font-normal leading-tight text-muted-foreground">
                    {meta.description}
                  </span>
                </span>
              </Button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
