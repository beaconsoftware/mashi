"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useDroppable } from "@dnd-kit/core";
import { Sparkles, Check, Trash2, Clock, Layers } from "lucide-react";
import { useGSAP } from "@gsap/react";
import { gsap, EASE, DUR, staggerEntry } from "@/lib/animation";
import type { S2DItem, Pathway, Priority, S2DStatus } from "@/types";
import { PATHWAY_META, PRIORITY_META, STATUS_META } from "@/types";
import { SourceIcon } from "@/components/shared/source-icon";
import { CompanyBadge } from "@/components/shared/company-badge";
import { Button } from "@/components/ui/button";
import { useUpdateS2DItem } from "@/hooks/use-s2d";
import { useS2DStore } from "@/store/s2d-store";
import { cn } from "@/lib/utils";
import { ReviewDeck } from "./review-deck";

interface Props {
  items: S2DItem[];
}

/**
 * "Review" pseudo-column — sits at the front of the kanban for newly
 * AI-triaged items that haven't been approved yet. Each card shows
 * Mashi's recommendation (pathway, priority, target status) with inline
 * controls to adjust, and Approve / Drop buttons to clear the item out
 * of the review queue.
 *
 * On Approve, needs_review flips to false and the item lands in its
 * recommended status column. On Drop, the item is closed with outcome
 * "Dropped before review".
 */
export function ReviewColumn({ items }: Props) {
  const { setNodeRef, isOver } = useDroppable({
    id: "review",
    data: { type: "column", status: "review" },
  });
  const listRef = useRef<HTMLDivElement | null>(null);
  const [deckOpen, setDeckOpen] = useState(false);

  // Deep-link entry: ?review=1 on /s2d (used by the Cockpit "Start swipe
  // deck" CTA) auto-opens the deck and strips the param so a reload doesn't
  // re-trigger. Without this consumer, the cockpit button used to land the
  // user on the board with the deck closed — a silent dead-end.
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  useEffect(() => {
    if (searchParams.get("review") !== "1") return;
    if (items.length === 0) return;
    setDeckOpen(true);
    const next = new URLSearchParams(searchParams.toString());
    next.delete("review");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [searchParams, items.length, router, pathname]);

  useGSAP(
    () => {
      if (!listRef.current) return;
      const cards = listRef.current.querySelectorAll("[data-review-card]");
      if (cards.length === 0) return;
      staggerEntry(cards, { stagger: 0.04, y: 10, duration: 0.36 });
    },
    { scope: listRef, dependencies: [items.length] }
  );

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex h-full min-h-0 w-80 shrink-0 flex-col rounded-md border bg-secondary/20 transition-colors",
        "border-primary/40 ring-1 ring-primary/10",
        isOver && "bg-primary/5"
      )}
    >
      <div className="flex items-center justify-between border-b border-primary/30 bg-primary/10 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-primary">
            Review
          </span>
          <span className="font-mono text-[10px] text-muted-foreground">{items.length}</span>
        </div>
        {items.length > 0 && (
          <button
            onClick={() => setDeckOpen(true)}
            className="flex items-center gap-1 rounded bg-primary px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary-foreground hover:bg-primary/90"
            title="Open the swipe-deck review"
          >
            <Layers className="h-3 w-3" />
            Swipe
          </button>
        )}
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto p-2 space-y-2">
        {items.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center gap-1 rounded border border-dashed border-border/40 px-4 text-center text-[11px] text-muted-foreground/70">
            <Sparkles className="h-4 w-4" />
            <span>All caught up.</span>
            <span>New items from Mashi will land here.</span>
          </div>
        ) : (
          items.map((item) => <ReviewCard key={item.id} item={item} />)
        )}
      </div>
      <ReviewDeck items={items} open={deckOpen} onClose={() => setDeckOpen(false)} />
    </div>
  );
}

function ReviewCard({ item }: { item: S2DItem }) {
  const updateItem = useUpdateS2DItem();
  const setSelected = useS2DStore((s) => s.setSelectedItem);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [hiding, setHiding] = useState(false);

  // Local edits before approve — lets the user tweak without firing a DB
  // write per click. Synced on Approve.
  const [priority, setPriority] = useState<Priority>(item.priority);
  const [pathway, setPathway] = useState<Pathway>(item.pathway);
  const [targetStatus, setTargetStatus] = useState<S2DStatus>(item.status);

  function approveWithExit(patch: Record<string, unknown>, then: "approve" | "drop") {
    if (!cardRef.current) {
      updateItem.mutate({ id: item.id, patch: patch as Partial<S2DItem> });
      return;
    }
    setHiding(true);
    gsap.to(cardRef.current, {
      x: then === "approve" ? 60 : -60,
      opacity: 0,
      scale: 0.92,
      duration: DUR.short,
      ease: EASE.out,
      onComplete: () => {
        updateItem.mutate({ id: item.id, patch: patch as Partial<S2DItem> });
      },
    });
  }

  function approve() {
    approveWithExit(
      {
        needs_review: false,
        priority,
        pathway,
        status: targetStatus,
      },
      "approve"
    );
  }

  function drop() {
    approveWithExit(
      {
        needs_review: false,
        status: "done",
        outcome: "Dropped before review",
        resolved_via: "manual",
      },
      "drop"
    );
  }

  const priorityMeta = PRIORITY_META[priority];
  const pathwayMeta = PATHWAY_META[pathway];

  return (
    <div
      ref={cardRef}
      data-review-card
      onClick={(e) => {
        // Only open the detail sheet if the click was on the body, not a control
        if ((e.target as HTMLElement).closest("button, select")) return;
        setSelected(item.id);
      }}
      className={cn(
        "group relative cursor-pointer rounded-md border border-border/60 bg-card p-2.5 text-left transition-all hover:border-primary/40 hover:shadow-md",
        hiding && "pointer-events-none"
      )}
    >
      {/* NEW badge */}
      <div className="absolute -right-1 -top-1 rounded bg-primary px-1 py-px text-[8px] font-bold uppercase tracking-wider text-primary-foreground shadow-sm">
        NEW
      </div>

      <div className="mb-1.5 flex items-center gap-1.5">
        {item.ticket_number != null && (
          <span className="font-mono text-[10px] text-muted-foreground/80">
            MASH-{item.ticket_number}
          </span>
        )}
        {item.source_type && <SourceIcon type={item.source_type} />}
        {item.est_minutes != null && (
          <span className="ml-auto font-mono text-[10px] text-muted-foreground">
            {item.est_minutes}m
          </span>
        )}
      </div>

      <div className="text-[13px] leading-snug text-foreground/95">{item.title}</div>

      <div className="mt-2">
        <CompanyBadge company={item.company} />
      </div>

      {/* Inline controls */}
      <div className="mt-3 space-y-1.5">
        <div className="flex items-center gap-1">
          <span className="w-12 text-[10px] uppercase tracking-wider text-muted-foreground">
            Priority
          </span>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as Priority)}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 rounded border border-border/40 bg-secondary px-1.5 py-1 text-[11px]"
            style={{ color: priorityMeta.color }}
          >
            {(Object.keys(PRIORITY_META) as Priority[]).map((p) => (
              <option key={p} value={p}>
                {PRIORITY_META[p].label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-12 text-[10px] uppercase tracking-wider text-muted-foreground">
            Pathway
          </span>
          <select
            value={pathway}
            onChange={(e) => setPathway(e.target.value as Pathway)}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 rounded border border-border/40 bg-secondary px-1.5 py-1 text-[11px]"
          >
            {(Object.keys(PATHWAY_META) as Pathway[]).map((p) => (
              <option key={p} value={p}>
                {PATHWAY_META[p].label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-12 text-[10px] uppercase tracking-wider text-muted-foreground">
            Send to
          </span>
          <select
            value={targetStatus}
            onChange={(e) => setTargetStatus(e.target.value as S2DStatus)}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 rounded border border-border/40 bg-secondary px-1.5 py-1 text-[11px]"
          >
            <option value="todo">{STATUS_META.todo.label}</option>
            <option value="backlog">{STATUS_META.backlog.label}</option>
            <option value="in_queue">{STATUS_META.in_queue.label}</option>
          </select>
        </div>
      </div>

      {item.queue_reason && (
        <div className="mt-2 flex items-center gap-1.5 rounded border border-border/40 bg-secondary/40 px-1.5 py-1 text-[11px] text-muted-foreground">
          <Clock className="h-3 w-3 shrink-0" />
          <span className="truncate">{item.queue_reason}</span>
        </div>
      )}

      <div className="mt-2 flex gap-1.5">
        <Button
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            approve();
          }}
          className="flex-1 gap-1 h-7 text-[11px]"
        >
          <Check className="h-3 w-3" />
          Approve
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={(e) => {
            e.stopPropagation();
            drop();
          }}
          className="gap-1 h-7 text-[11px] text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="h-3 w-3" />
          Drop
        </Button>
      </div>
    </div>
  );
}
