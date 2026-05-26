"use client";

// translucency-audit-ok: file — extracted from the legacy SprintCardWorkspace; sanctioned /55 + /80 + custom hover steps in the merged source rows. Migrate alongside the next visual pass on the refine sheet + future side-strip variant.

import { useMemo, useRef } from "react";
import {
  Inbox,
  Calendar,
  GitBranch,
  KanbanSquare,
  MessageSquare,
  Pin,
  PinOff,
} from "lucide-react";
import { useGSAP } from "@gsap/react";
import { gsap, DUR, EASE, withMotion } from "@/lib/animation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useCachedContextSignals } from "./sprint-item-context";
import { mergeSources, type MergedSource } from "@/lib/sprint/merge-sources";
import {
  useEnrichedContext,
  usePinSource,
  type EnrichSourceKind,
} from "@/hooks/use-enriched-context";
import type { S2DItem } from "@/types";

/**
 * Single ordered list of pulled + cached sources, used by:
 *   • the Refine sheet's side strip
 *   • the per-canvas sources strip (when the canvas opts in)
 *
 * Lives outside any specific canvas so re-pathwaying doesn't unmount the
 * list — pinned state stays put while the user moves between canvases.
 *
 * Was originally exported from `sprint-card-workspace.tsx`; that file
 * died with Phase 4. The Phase 5 work on the spawned rail / contract
 * card might bundle it back into a Surface primitive — until then,
 * keeping it standalone is the smallest possible surface.
 */
interface MergedSourceListProps {
  item: S2DItem;
  /** When false, the underlying cached-context fetch is suppressed. */
  enabled?: boolean;
  /** Reserved for layout variants — informational only today. */
  variant?: "rail" | "below-canvas" | "side-strip";
  /**
   * Internal alias used by rail callsites that pass `active` straight
   * through. Treated as `enabled`.
   */
  active?: boolean;
}

export function MergedSourceList({
  item,
  enabled,
  active,
  variant = "rail",
}: MergedSourceListProps) {
  const on = enabled ?? active ?? true;
  const { data } = useEnrichedContext(item.id);
  const pulled = data?.enriched_context?.pulled_sources ?? [];
  const { sources: cached } = useCachedContextSignals(item, on);
  const pin = usePinSource(item.id);
  const merged = useMemo(() => mergeSources(pulled, cached), [pulled, cached]);
  const pinnedCount = merged.filter((s) => s.pinned).length;

  if (merged.length === 0) {
    return (
      <div className="rounded border border-dashed border-border/40 px-2 py-3 text-[10px] leading-snug text-muted-foreground/80">
        Run Enrich to surface related items, recent messages, meetings, and
        Linear issues — they&apos;ll appear here.
      </div>
    );
  }

  return (
    <div data-variant={variant}>
      <div className="px-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/80">
        Sources{" "}
        <span className="font-normal normal-case tracking-normal text-muted-foreground/60">
          · {merged.length} total · {pinnedCount} pinned
        </span>
      </div>
      <ul className="mt-1.5 space-y-1.5">
        {merged.map((s) => (
          <MergedSourceRow
            key={`${s.kind}:${s.ref}`}
            source={s}
            onTogglePin={
              s.origin === "pulled"
                ? () =>
                    pin.mutate({
                      source: { kind: s.kind, ref: s.ref },
                      pinned: !s.pinned,
                    })
                : undefined
            }
          />
        ))}
      </ul>
    </div>
  );
}

function MergedSourceRow({
  source,
  onTogglePin,
}: {
  source: MergedSource;
  onTogglePin?: () => void;
}) {
  const rootRef = useRef<HTMLLIElement | null>(null);
  useGSAP(
    () => {
      if (!rootRef.current) return;
      withMotion(() => {
        gsap.fromTo(
          rootRef.current,
          { opacity: 0, y: 4 },
          {
            opacity: 1,
            y: 0,
            duration: DUR.short,
            ease: EASE.out,
            clearProps: "all",
          }
        );
      });
    },
    { scope: rootRef }
  );

  return (
    <li
      ref={rootRef}
      className={cn(
        "group/source flex items-start gap-1.5 rounded border px-1.5 py-1.5 text-[11px] transition-colors",
        source.pinned
          ? "border-primary/40 bg-primary/8 hover:border-primary/60"
          : "border-border/30 bg-card/40 hover:border-border/60 hover:bg-card/70"
      )}
    >
      <SourceKindIcon kind={source.kind} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] font-medium leading-tight text-foreground/90">
          {source.label}
        </div>
        <div className="mt-0.5 flex items-center gap-1 font-mono text-[9px] text-muted-foreground/70">
          {source.when && <span>{source.when.slice(0, 10)}</span>}
          {source.origin === "cached" && (
            <span
              className="rounded bg-secondary/60 px-1 py-px text-[8px] uppercase tracking-wider text-muted-foreground/80"
              title="Linked at triage, cached on the item — pin via Enrich to keep across refine."
            >
              cached
            </span>
          )}
        </div>
      </div>
      {onTogglePin && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onTogglePin}
          aria-pressed={source.pinned}
          aria-label={source.pinned ? "Unpin source" : "Pin source"}
          title={
            source.pinned
              ? "Unpin — drops from future refine + downstream actions"
              : "Pin — keeps this source across refine + feeds Claude / Draft"
          }
          className={cn(
            "mashi-press h-6 w-6 shrink-0",
            source.pinned
              ? "text-primary hover:bg-primary/15"
              : "text-muted-foreground/40 opacity-0 group-hover/source:opacity-100 hover:bg-accent hover:text-foreground"
          )}
        >
          {source.pinned ? <Pin className="h-3 w-3" /> : <PinOff className="h-3 w-3" />}
        </Button>
      )}
    </li>
  );
}

function SourceKindIcon({ kind }: { kind: EnrichSourceKind }) {
  const props = { className: "h-3 w-3 shrink-0 text-muted-foreground" };
  switch (kind) {
    case "s2d":
      return <KanbanSquare {...props} />;
    case "gmail":
      return <Inbox {...props} />;
    case "slack":
      return <MessageSquare {...props} />;
    case "linear":
      return <GitBranch {...props} />;
    case "fireflies":
      return <Calendar {...props} />;
  }
}
