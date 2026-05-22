"use client";

// translucency-audit-ok: file — legacy callsites, migrate to sanctioned scale (/15, /40, /55, /60, /80, /95) case-by-case during component touch-ups.

/**
 * Swipe-based sprint planner — alternative to the list-based
 * PlannerPrioritize for users who prefer the Tinder-style
 * one-decision-at-a-time flow.
 *
 * For each open item (status in todo / backlog / in_queue, not done):
 *   →  Add to sprint
 *   ←  Skip (leave as-is, don't add)
 *   ↑  Defer to backlog (status='backlog')
 *   ↓  Snooze 24h (status='in_queue' until tomorrow 9am)
 *
 * "Lock in" at the bottom advances the sprint-store phase from
 * 'prioritize' to 'schedule' with the user's selectedItemIds set.
 *
 * Design notes (lessons from review-deck pain):
 *   - Single card render. No visible "behind cards" depth illusion —
 *     pure CSS drop-shadow on the front card suggests depth.
 *   - Zero opacity tweens anywhere. Cards pop in. No card-transparent-
 *     mid-animation bug.
 *   - Inline opaque background on the overlay — bypasses any Tailwind
 *     class collision.
 *   - swipingRef + clearable safety timeout (defends against killed
 *     tweens leaving the guard stuck true).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  X,
  ArrowDown,
  ArrowUp,
  Trash2,
  Keyboard,
  Plus,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUpdateS2DItem } from "@/hooks/use-s2d";
import { useSprintStore } from "@/store/sprint-store";
import { gsap, EASE, DUR } from "@/lib/animation";
import { SourceIcon } from "@/components/shared/source-icon";
import { CompanyBadge } from "@/components/shared/company-badge";
import { PathwayBadge } from "@/components/shared/pathway-badge";
import { PriorityDot } from "@/components/shared/priority-dot";
import {
  PRIORITY_META,
  PATHWAY_META,
  type S2DItem,
} from "@/types";
import { cn } from "@/lib/utils";

type SwipeAction = "add" | "skip" | "backlog" | "snooze";

interface Props {
  /**
   * Items already filtered + sorted by the parent shell. Receiving them
   * via props (rather than fetching internally) means the empty-deck bug
   * can't recur — loading and empty states are handled one level up.
   */
  eligibleItems: S2DItem[];
}

export function PlannerPrioritizeSwipe({ eligibleItems }: Props) {
  const updateItem = useUpdateS2DItem();
  const selected = useSprintStore((s) => s.selectedItemIds);
  const toggle = useSprintStore((s) => s.toggleSelected);
  const setPhase = useSprintStore((s) => s.setPhase);
  const exit = useSprintStore((s) => s.exitSprint);

  // Snapshot the deck order once so swipes don't reshuffle if TanStack
  // refetches mid-session. The eligibleItems prop is already filtered
  // + sorted by the shell, so we just freeze the reference.
  const deckRef = useRef<S2DItem[]>([]);
  const initialisedRef = useRef(false);
  const [cursor, setCursor] = useState(0);

  if (!initialisedRef.current && eligibleItems.length > 0) {
    deckRef.current = eligibleItems.slice();
    initialisedRef.current = true;
  }

  const remaining = deckRef.current.length - cursor;
  const current = deckRef.current[cursor];

  const topCardRef = useRef<HTMLDivElement | null>(null);
  const swipingRef = useRef(false);
  const safetyRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearSafety() {
    if (safetyRef.current) {
      clearTimeout(safetyRef.current);
      safetyRef.current = null;
    }
  }
  useEffect(() => clearSafety, []);

  const applyAction = useCallback(
    (action: SwipeAction) => {
      if (!current) return;
      try {
        if (action === "add") {
          // Toggle into the selected list if not already. We don't move
          // status here — that happens at lock-in / sprint start.
          if (!selected.includes(current.id)) toggle(current.id);
        } else if (action === "backlog") {
          updateItem.mutate({
            id: current.id,
            patch: { status: "backlog" },
          });
        } else if (action === "snooze") {
          const t = new Date();
          t.setDate(t.getDate() + 1);
          t.setHours(9, 0, 0, 0);
          updateItem.mutate({
            id: current.id,
            patch: {
              status: "in_queue",
              snoozed_until: t.toISOString(),
              queue_reason: "Snoozed from sprint plan (24h)",
            },
          });
        }
        // "skip" is intentionally a no-op — item stays where it is.
      } catch (err) {
        console.error("[planner-swipe] applyAction failed:", err);
      } finally {
        setCursor((c) => c + 1);
      }
    },
    [current, selected, toggle, updateItem]
  );

  const flyOff = useCallback(
    (action: SwipeAction, dir: { x: number; y: number }) => {
      if (!topCardRef.current) return;
      if (swipingRef.current) return;
      swipingRef.current = true;
      const card = topCardRef.current;
      gsap.killTweensOf(card);
      clearSafety();
      const vec = normalize(dir);
      const distance = 800;
      const rot = dir.x * 0.08;
      safetyRef.current = setTimeout(() => {
        if (swipingRef.current) {
          safetyRef.current = null;
          applyAction(action);
          swipingRef.current = false;
        }
      }, 600);
      gsap.to(card, {
        x: vec.x * distance,
        y: vec.y * distance,
        rotation: rot,
        opacity: 0,
        duration: DUR.short,
        ease: EASE.out,
        onComplete: () => {
          clearSafety();
          applyAction(action);
          swipingRef.current = false;
        },
      });
    },
    [applyAction]
  );

  // Pointer drag
  const dragState = useRef({ x: 0, y: 0, dragging: false });
  function actionForRelease(x: number, y: number): SwipeAction | null {
    const ax = Math.abs(x);
    const ay = Math.abs(y);
    if (ax < 100 && ay < 100) return null;
    if (ax > ay) return x > 0 ? "add" : "skip";
    return y < 0 ? "backlog" : "snooze";
  }
  function onPointerDown(e: React.PointerEvent) {
    if (!topCardRef.current) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragState.current = { x: 0, y: 0, dragging: true };
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!dragState.current.dragging || !topCardRef.current) return;
    dragState.current.x += e.movementX;
    dragState.current.y += e.movementY;
    const { x, y } = dragState.current;
    gsap.set(topCardRef.current, { x, y, rotation: x * 0.06 });
  }
  function onPointerUp(e: React.PointerEvent) {
    if (!dragState.current.dragging || !topCardRef.current) return;
    dragState.current.dragging = false;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    const { x, y } = dragState.current;
    const action = actionForRelease(x, y);
    if (action) {
      flyOff(action, { x, y });
    } else {
      gsap.to(topCardRef.current, {
        x: 0,
        y: 0,
        rotation: 0,
        duration: DUR.short,
        ease: EASE.back,
      });
    }
  }

  // Keyboard
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName ?? "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        flyOff("add", { x: 1, y: 0 });
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        flyOff("skip", { x: -1, y: 0 });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        flyOff("backlog", { x: 0, y: -1 });
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        flyOff("snooze", { x: 0, y: 1 });
      } else if (e.key === "Escape") {
        exit();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flyOff, exit]);

  const lockIn = useCallback(() => {
    if (selected.length === 0) {
      // Nothing picked; bail back to idle.
      exit();
      return;
    }
    setPhase("schedule");
  }, [selected.length, setPhase, exit]);

  // Done-screen when we run out of items
  if (!current) {
    return (
      <DoneScreen
        selectedCount={selected.length}
        onLockIn={lockIn}
        onExit={exit}
      />
    );
  }

  const isSelected = selected.includes(current.id);
  const priorityMeta = PRIORITY_META[current.priority];

  return (
    <div className="flex h-full w-full flex-col">
      {/* Top: progress + close */}
      <div className="flex items-center gap-3 border-b border-border/40 px-6 py-4">
        <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
          {cursor + 1} / {deckRef.current.length}
        </span>
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-secondary/40">
          <div
            className="h-full bg-primary transition-all"
            style={{
              width: `${((cursor + 1) / deckRef.current.length) * 100}%`,
            }}
          />
        </div>
        <span className="rounded-md bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary">
          {selected.length} in sprint
        </span>
        <button
          onClick={exit}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Close (esc)"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Deck — single card. Generous vertical breathing room
          (py-10 / lg:py-14) so the card never feels cramped against
          the top progress bar or the bottom action bar, even on tall
          screens where the absolute-inset card stretches to fill. */}
      <div className="relative isolate flex-1 min-h-0 select-none px-6 py-10 lg:py-14">
        <CardFace
          key={current.id}
          item={current}
          isAlreadySelected={isSelected}
          cardRef={topCardRef}
          style={{
            zIndex: 3,
            boxShadow:
              "0 8px 24px -4px hsl(0 0% 0% / 0.5), 0 12px 0 -4px hsl(240 8% 7% / 1), 0 12px 1px -4px hsl(240 5% 25% / 0.4), 0 22px 0 -8px hsl(240 8% 7% / 1), 0 22px 1px -8px hsl(240 5% 25% / 0.25)",
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        />
      </div>

      {/* Action buttons */}
      <ActionBar
        onSwipe={(a) => flyOff(a, vectorFor(a))}
        remaining={remaining}
        selectedCount={selected.length}
        onLockIn={lockIn}
      />

      {/* Keyboard hints */}
      <div className="mb-5 mt-2 flex items-center justify-center gap-3 text-[10px] text-muted-foreground">
        <Keyboard className="h-3 w-3" />
        <Shortcut k="←" label="skip" />
        <Shortcut k="→" label="add to sprint" />
        <Shortcut k="↑" label="defer to backlog" />
        <Shortcut k="↓" label="snooze 24h" />
        <Shortcut k="esc" label="close" />
      </div>
    </div>
  );

  // helpers

  function vectorFor(action: SwipeAction): { x: number; y: number } {
    switch (action) {
      case "add":
        return { x: 1, y: 0 };
      case "skip":
        return { x: -1, y: 0 };
      case "backlog":
        return { x: 0, y: -1 };
      case "snooze":
        return { x: 0, y: 1 };
    }
  }
}

function CardFace({
  item,
  isAlreadySelected,
  cardRef,
  style,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  item: S2DItem;
  isAlreadySelected: boolean;
  cardRef: React.RefObject<HTMLDivElement | null>;
  style?: React.CSSProperties;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
}) {
  const priorityMeta = PRIORITY_META[item.priority];
  const pathwayMeta = PATHWAY_META[item.pathway];
  const estMinutes = item.est_minutes ?? null;

  return (
    <div
      ref={cardRef}
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className={cn(
        // max-h prevents the card from stretching the full deck
        // container on tall viewports. my-auto + inset-x-0 centers it
        // vertically within the inset-0 deck area. The card sizes to
        // its content within these caps.
        "absolute inset-x-0 mx-auto my-auto flex max-h-[640px] w-full max-w-lg cursor-grab touch-none flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl active:cursor-grabbing",
        "inset-y-0",
        isAlreadySelected && "ring-2 ring-primary/40"
      )}
    >
      <div className="flex items-center gap-2 border-b border-border/30 px-4 py-3">
        <span className="font-mono text-[11px] text-muted-foreground">
          MASH-{item.ticket_number}
        </span>
        {item.source_type && <SourceIcon type={item.source_type} withLabel />}
        {isAlreadySelected && (
          <span className="ml-auto rounded bg-primary/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-primary">
            in sprint
          </span>
        )}
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-5">
        <h2 className="text-balance text-2xl font-semibold leading-tight">
          {item.title}
        </h2>

        {item.company && (
          <div>
            <CompanyBadge company={item.company} />
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <PathwayBadge pathway={item.pathway} compact={false} />
          <div
            className="rounded px-2 py-0.5 text-[11px] font-medium"
            style={{
              background: `${priorityMeta.color}22`,
              color: priorityMeta.color,
            }}
          >
            <span className="mr-1 inline-flex translate-y-[-1px]">
              <PriorityDot priority={item.priority} />
            </span>
            {priorityMeta.label}
          </div>
          <span className="rounded bg-secondary px-2 py-0.5 text-[11px] font-medium text-foreground/85">
            {item.status}
          </span>
          {estMinutes != null && (
            <span className="rounded border border-border/40 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
              ~{estMinutes}m
            </span>
          )}
        </div>

        {item.description && (
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/80">
            {item.description}
          </p>
        )}

        {/* Why this matters cue */}
        <div className="space-y-1 rounded-lg border border-border/30 bg-secondary/30 p-3 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
            <Sparkles className="h-3 w-3" />
            Why this is on your plate
          </div>
          <p>
            {pathwayMeta.description} ·{" "}
            <span style={{ color: priorityMeta.color }}>
              {priorityMeta.label} priority
            </span>{" "}
            ·{" "}
            {estMinutes != null
              ? `est. ${estMinutes} min`
              : "no time estimate"}
            {item.queue_reason ? ` · ${item.queue_reason}` : ""}
          </p>
        </div>
      </div>
    </div>
  );
}

function ActionBar({
  onSwipe,
  remaining,
  selectedCount,
  onLockIn,
}: {
  onSwipe: (a: SwipeAction) => void;
  remaining: number;
  selectedCount: number;
  onLockIn: () => void;
}) {
  return (
    <div className="flex items-center justify-center gap-2 px-5 pb-2">
      <Button
        variant="outline"
        size="lg"
        onClick={() => onSwipe("skip")}
        className="h-12 w-12 rounded-full p-0"
        title="Skip (←)"
      >
        <X className="h-5 w-5" />
      </Button>
      <Button
        variant="outline"
        size="lg"
        onClick={() => onSwipe("backlog")}
        className="h-12 w-12 rounded-full p-0"
        title="Defer to backlog (↑)"
      >
        <ArrowUp className="h-5 w-5" />
      </Button>
      <Button
        variant="outline"
        size="lg"
        onClick={() => onSwipe("snooze")}
        className="h-12 w-12 rounded-full p-0 text-orange-400"
        title="Snooze 24h (↓)"
      >
        <ArrowDown className="h-5 w-5" />
      </Button>
      <Button
        size="lg"
        onClick={() => onSwipe("add")}
        className="h-12 w-12 rounded-full p-0 bg-primary text-primary-foreground hover:bg-primary/90"
        title="Add to sprint (→)"
      >
        <Plus className="h-5 w-5" />
      </Button>
      <div className="ml-3 flex flex-col gap-1 text-[11px] text-muted-foreground">
        <span>{remaining} left</span>
        <Button
          size="sm"
          variant={selectedCount > 0 ? "default" : "outline"}
          onClick={onLockIn}
          disabled={selectedCount === 0}
          className="h-6 gap-1 text-[10px]"
        >
          <Check className="h-3 w-3" />
          Lock in {selectedCount > 0 ? `(${selectedCount})` : ""}
        </Button>
      </div>
    </div>
  );
}

function Shortcut({ k, label }: { k: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <kbd className="rounded border border-border/40 bg-secondary px-1.5 py-0.5 font-mono text-[10px]">
        {k}
      </kbd>
      <span>{label}</span>
    </span>
  );
}

function DoneScreen({
  selectedCount,
  onLockIn,
  onExit,
}: {
  selectedCount: number;
  onLockIn: () => void;
  onExit: () => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/15">
        <Sparkles className="h-6 w-6 text-primary" />
      </div>
      <h2 className="text-xl font-semibold">Deck cleared</h2>
      <p className="text-sm text-muted-foreground">
        {selectedCount === 0
          ? "No items selected for the sprint."
          : `${selectedCount} item${selectedCount === 1 ? "" : "s"} selected for today's sprint.`}
      </p>
      <div className="flex items-center gap-2">
        <Button variant="outline" onClick={onExit}>
          Cancel
        </Button>
        <Button onClick={onLockIn} disabled={selectedCount === 0}>
          {selectedCount === 0 ? "Nothing to lock in" : "Lock in & schedule"}
        </Button>
      </div>
    </div>
  );
}

function normalize(v: { x: number; y: number }): { x: number; y: number } {
  const mag = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / mag, y: v.y / mag };
}

// Suppress "unused import" for icons referenced only by Button title="..."
void [Trash2, useMemo];
