"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Sparkles,
  Check,
  Trash2,
  ArrowDown,
  ArrowUp,
  X,
  Keyboard,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { S2DItem, Pathway, Priority, S2DStatus } from "@/types";
import { PATHWAY_META, PRIORITY_META } from "@/types";
import { SourceIcon } from "@/components/shared/source-icon";
import { CompanyBadge } from "@/components/shared/company-badge";
import { useUpdateS2DItem } from "@/hooks/use-s2d";
import { useGSAP } from "@gsap/react";
import { gsap, EASE, DUR, heroEntry } from "@/lib/animation";
import { cn } from "@/lib/utils";

/**
 * Tinder-style swipe deck for the Review queue.
 *
 * Four swipe directions, each tied to a real S2D outcome:
 *   →  approve into Mashi's recommended status (priority/pathway honor inline edits)
 *   ←  drop (closed with outcome "Dropped before review")
 *   ↑  defer to backlog (approved but status forced to backlog)
 *   ↓  snooze 24h (status=in_queue, snoozed_until=tomorrow)
 *
 * Three input modes: pointer drag, action buttons, keyboard arrows.
 *
 * The cards are a 3-deep stack: top card is interactive, the two behind
 * peek with slight scale + y offset so the deck reads as having depth.
 * On swipe, the top card flies off; the next card animates forward into
 * the active position with a small overshoot bounce.
 */

interface Props {
  items: S2DItem[];
  open: boolean;
  onClose: () => void;
}

type SwipeAction = "approve" | "drop" | "backlog" | "snooze";

export function ReviewDeck({ items, open, onClose }: Props) {
  const updateItem = useUpdateS2DItem();
  const [cursor, setCursor] = useState(0);
  // Per-item user overrides — collected on the visible card, applied on swipe.
  const [overrides, setOverrides] = useState<
    Record<string, { priority?: Priority; pathway?: Pathway; status?: S2DStatus }>
  >({});
  const [justifying, setJustifying] = useState(false);

  // Snapshot the deck order when opened so swipes don't reshuffle mid-session
  const deckRef = useRef<S2DItem[]>([]);
  useEffect(() => {
    if (open) {
      deckRef.current = items.slice();
      setCursor(0);
      setOverrides({});
    }
  }, [open, items]);

  // Lazy-backfill justifications for items missing them
  useEffect(() => {
    if (!open) return;
    const missing = deckRef.current
      .filter((i) => !i.review_justification)
      .map((i) => i.id);
    if (missing.length === 0) return;
    setJustifying(true);
    fetch("/api/s2d/justify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: missing }),
    })
      .catch(() => undefined)
      .finally(() => setJustifying(false));
  }, [open]);

  const remaining = deckRef.current.length - cursor;
  const current = deckRef.current[cursor];
  const next1 = deckRef.current[cursor + 1];
  const next2 = deckRef.current[cursor + 2];

  const topCardRef = useRef<HTMLDivElement | null>(null);
  const next1Ref = useRef<HTMLDivElement | null>(null);
  const next2Ref = useRef<HTMLDivElement | null>(null);

  const applySwipe = useCallback(
    async (action: SwipeAction) => {
      if (!current) return;
      const o = overrides[current.id] ?? {};
      const priority = o.priority ?? current.priority;
      const pathway = o.pathway ?? current.pathway;
      let status: S2DStatus = o.status ?? current.status;

      const patch: Partial<S2DItem> & Record<string, unknown> = {
        priority,
        pathway,
      };

      if (action === "approve") {
        patch.needs_review = false;
        patch.status = status;
      } else if (action === "backlog") {
        patch.needs_review = false;
        patch.status = "backlog";
        status = "backlog";
      } else if (action === "snooze") {
        patch.needs_review = false;
        patch.status = "in_queue";
        const t = new Date();
        t.setDate(t.getDate() + 1);
        t.setHours(9, 0, 0, 0);
        patch.snoozed_until = t.toISOString();
        patch.queue_reason = "Snoozed from review (24h)";
      } else if (action === "drop") {
        patch.needs_review = false;
        patch.status = "done";
        patch.outcome = "Dropped before review";
        patch.resolved_via = "manual";
      }

      updateItem.mutate({ id: current.id, patch });
      setCursor((c) => c + 1);
    },
    [current, overrides, updateItem]
  );

  // ───────────────────────────── Pointer drag ─────────────────────────────
  const dragState = useRef({ x: 0, y: 0, dragging: false });

  const flyOff = useCallback(
    (action: SwipeAction, dir: { x: number; y: number }) => {
      if (!topCardRef.current) return;
      const card = topCardRef.current;
      // Compute end position outside the viewport in the swipe direction
      const vec = normalize(dir);
      const distance = 800;
      const rot = dir.x * 0.08;
      gsap.to(card, {
        x: vec.x * distance,
        y: vec.y * distance,
        rotation: rot,
        opacity: 0,
        duration: DUR.short,
        ease: EASE.out,
        onComplete: () => {
          applySwipe(action);
        },
      });
      // Animate the next card forward into the active position
      if (next1Ref.current) {
        gsap.to(next1Ref.current, {
          scale: 1,
          y: 0,
          duration: DUR.base,
          ease: EASE.back,
        });
      }
    },
    [applySwipe]
  );

  function actionForRelease(x: number, y: number): SwipeAction | null {
    const ax = Math.abs(x);
    const ay = Math.abs(y);
    const THRESH = 100;
    if (ax < THRESH && ay < THRESH) return null;
    if (ax > ay) return x > 0 ? "approve" : "drop";
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
    const rot = x * 0.06;
    gsap.set(topCardRef.current, { x, y, rotation: rot });

    // Tint background indicator (approve green if x>0, drop red if x<0, etc.)
    const overlay = topCardRef.current.querySelector(
      "[data-swipe-overlay]"
    ) as HTMLElement | null;
    if (overlay) {
      const action = actionForRelease(x, y);
      const intensity = Math.min(1, (Math.abs(x) + Math.abs(y)) / 200);
      let color = "transparent";
      let label = "";
      if (action === "approve") {
        color = `rgba(34, 197, 94, ${intensity * 0.25})`;
        label = "APPROVE";
      } else if (action === "drop") {
        color = `rgba(239, 68, 68, ${intensity * 0.25})`;
        label = "DROP";
      } else if (action === "backlog") {
        color = `rgba(99, 102, 241, ${intensity * 0.25})`;
        label = "BACKLOG";
      } else if (action === "snooze") {
        color = `rgba(234, 179, 8, ${intensity * 0.25})`;
        label = "SNOOZE";
      }
      overlay.style.background = color;
      overlay.dataset.label = label;
    }
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
      // Snap back
      gsap.to(topCardRef.current, {
        x: 0,
        y: 0,
        rotation: 0,
        duration: DUR.short,
        ease: EASE.back,
      });
      const overlay = topCardRef.current.querySelector(
        "[data-swipe-overlay]"
      ) as HTMLElement | null;
      if (overlay) {
        overlay.style.background = "transparent";
        overlay.dataset.label = "";
      }
    }
  }

  // ───────────────────────────── Keyboard ─────────────────────────────
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName ?? "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        flyOff("approve", { x: 1, y: 0 });
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        flyOff("drop", { x: -1, y: 0 });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        flyOff("backlog", { x: 0, y: -1 });
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        flyOff("snooze", { x: 0, y: 1 });
      } else if (e.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, flyOff, onClose]);

  // ───────────────────────────── Entry animation ─────────────────────────────
  const rootRef = useRef<HTMLDivElement | null>(null);
  useGSAP(
    () => {
      if (!open || !rootRef.current) return;
      gsap.from(rootRef.current, {
        opacity: 0,
        duration: DUR.short,
        ease: EASE.out,
      });
      const card = topCardRef.current;
      if (card) heroEntry(card);
    },
    { dependencies: [open, cursor] }
  );

  // Reset top card transform when cursor advances so the new top card starts
  // at neutral position
  useEffect(() => {
    if (topCardRef.current) {
      gsap.set(topCardRef.current, { x: 0, y: 0, rotation: 0, opacity: 1 });
      const overlay = topCardRef.current.querySelector(
        "[data-swipe-overlay]"
      ) as HTMLElement | null;
      if (overlay) {
        overlay.style.background = "transparent";
        overlay.dataset.label = "";
      }
    }
    if (next1Ref.current) gsap.set(next1Ref.current, { scale: 0.95, y: 8 });
    if (next2Ref.current) gsap.set(next2Ref.current, { scale: 0.9, y: 16 });
  }, [cursor]);

  if (!open) return null;

  // Sprint complete on deck
  if (!current) {
    return (
      <Overlay onClose={onClose}>
        <DoneScreen onClose={onClose} count={deckRef.current.length} />
      </Overlay>
    );
  }

  const o = overrides[current.id] ?? {};

  return (
    <Overlay onClose={onClose} rootRef={rootRef}>
      <div className="flex h-full w-full max-w-2xl flex-col p-6">
        {/* Top: progress + close */}
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
            {cursor + 1} / {deckRef.current.length}
          </span>
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-secondary/40">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${((cursor + 1) / deckRef.current.length) * 100}%` }}
            />
          </div>
          {justifying && (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Generating justifications…
            </span>
          )}
          <button
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            title="Close (esc)"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Deck */}
        <div className="relative my-6 flex-1 min-h-0 select-none">
          {next2 && (
            <CardFace
              item={next2}
              cardRef={next2Ref}
              style={{ transform: "scale(0.9) translateY(16px)", zIndex: 1 }}
              dim
              override={overrides[next2.id]}
              setOverride={() => undefined}
            />
          )}
          {next1 && (
            <CardFace
              item={next1}
              cardRef={next1Ref}
              style={{ transform: "scale(0.95) translateY(8px)", zIndex: 2 }}
              dim
              override={overrides[next1.id]}
              setOverride={() => undefined}
            />
          )}
          <CardFace
            item={current}
            cardRef={topCardRef}
            style={{ zIndex: 3 }}
            interactive
            override={o}
            setOverride={(patch) =>
              setOverrides((prev) => ({
                ...prev,
                [current.id]: { ...(prev[current.id] ?? {}), ...patch },
              }))
            }
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          />
        </div>

        {/* Action buttons */}
        <ActionBar onSwipe={(a) => flyOff(a, vectorFor(a))} remaining={remaining} />

        {/* Shortcut hint */}
        <div className="mt-3 flex items-center justify-center gap-3 text-[10px] text-muted-foreground">
          <Keyboard className="h-3 w-3" />
          <Shortcut k="←" label="drop" />
          <Shortcut k="→" label="approve" />
          <Shortcut k="↑" label="backlog" />
          <Shortcut k="↓" label="snooze 24h" />
          <Shortcut k="esc" label="close" />
        </div>
      </div>
    </Overlay>
  );
}

function Overlay({
  children,
  onClose,
  rootRef,
}: {
  children: React.ReactNode;
  onClose: () => void;
  rootRef?: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      ref={rootRef}
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {children}
    </div>
  );
}

interface CardFaceProps {
  item: S2DItem;
  cardRef: React.RefObject<HTMLDivElement | null>;
  style?: React.CSSProperties;
  dim?: boolean;
  interactive?: boolean;
  override?: { priority?: Priority; pathway?: Pathway; status?: S2DStatus };
  setOverride?: (patch: {
    priority?: Priority;
    pathway?: Pathway;
    status?: S2DStatus;
  }) => void;
  onPointerDown?: (e: React.PointerEvent) => void;
  onPointerMove?: (e: React.PointerEvent) => void;
  onPointerUp?: (e: React.PointerEvent) => void;
}

function CardFace({
  item,
  cardRef,
  style,
  dim,
  interactive,
  override,
  setOverride,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: CardFaceProps) {
  const priority = override?.priority ?? item.priority;
  const pathway = override?.pathway ?? item.pathway;
  const status = override?.status ?? item.status;
  const priorityMeta = PRIORITY_META[priority];
  const pathwayMeta = PATHWAY_META[pathway];

  return (
    <div
      ref={cardRef}
      style={style}
      onPointerDown={interactive ? onPointerDown : undefined}
      onPointerMove={interactive ? onPointerMove : undefined}
      onPointerUp={interactive ? onPointerUp : undefined}
      className={cn(
        "absolute inset-0 mx-auto flex max-w-lg flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl",
        interactive ? "cursor-grab touch-none active:cursor-grabbing" : "pointer-events-none",
        dim && "opacity-70"
      )}
    >
      {/* Drag-direction tint overlay */}
      <div
        data-swipe-overlay
        className="pointer-events-none absolute inset-0 flex items-center justify-center transition-colors"
        style={{ background: "transparent" }}
      >
        <span
          className="font-mono text-4xl font-bold uppercase tracking-widest text-foreground/90"
          style={{
            opacity: 0,
            transition: "opacity 0.1s",
          }}
        >
          {/* label is set via data-label on parent; CSS sibling not used, but
             a future enhancement could surface text */}
        </span>
      </div>

      <div className="flex items-center gap-2 border-b border-border/30 px-4 py-3">
        <span className="font-mono text-[11px] text-muted-foreground">
          MASH-{item.ticket_number}
        </span>
        {item.source_type && <SourceIcon type={item.source_type} withLabel />}
        <span className="ml-auto rounded bg-primary px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-primary-foreground">
          NEW
        </span>
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

        {item.description && (
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/80">
            {item.description}
          </p>
        )}

        {/* Mashi's justification */}
        <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
            <Sparkles className="h-3 w-3" />
            Mashi suggests
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            <span
              className="rounded px-2 py-0.5 font-medium"
              style={{ background: `${priorityMeta.color}22`, color: priorityMeta.color }}
            >
              Priority: {priorityMeta.label}
            </span>
            <span className="rounded bg-secondary px-2 py-0.5 font-medium text-foreground/85">
              Pathway: {pathwayMeta.label}
            </span>
            <span className="rounded bg-secondary px-2 py-0.5 font-medium text-foreground/85">
              → {status}
            </span>
          </div>
          {item.review_justification ? (
            <p className="text-[12px] leading-relaxed text-foreground/85">
              {item.review_justification}
            </p>
          ) : (
            <p className="text-[11px] italic text-muted-foreground">
              Generating justification…
            </p>
          )}
        </div>

        {/* Inline overrides */}
        {interactive && setOverride && (
          <div className="grid grid-cols-3 gap-2 text-[11px]">
            <label className="space-y-1">
              <span className="block text-[9px] uppercase tracking-wider text-muted-foreground">
                Priority
              </span>
              <select
                value={priority}
                onChange={(e) => setOverride({ priority: e.target.value as Priority })}
                className="w-full rounded border border-border/40 bg-secondary px-1.5 py-1"
              >
                {(Object.keys(PRIORITY_META) as Priority[]).map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_META[p].label}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="block text-[9px] uppercase tracking-wider text-muted-foreground">
                Pathway
              </span>
              <select
                value={pathway}
                onChange={(e) => setOverride({ pathway: e.target.value as Pathway })}
                className="w-full rounded border border-border/40 bg-secondary px-1.5 py-1"
              >
                {(Object.keys(PATHWAY_META) as Pathway[]).map((p) => (
                  <option key={p} value={p}>
                    {PATHWAY_META[p].label}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="block text-[9px] uppercase tracking-wider text-muted-foreground">
                Send to
              </span>
              <select
                value={status}
                onChange={(e) => setOverride({ status: e.target.value as S2DStatus })}
                className="w-full rounded border border-border/40 bg-secondary px-1.5 py-1"
              >
                <option value="todo">Todo</option>
                <option value="backlog">Backlog</option>
                <option value="in_queue">In Queue</option>
              </select>
            </label>
          </div>
        )}
      </div>
    </div>
  );
}

function ActionBar({
  onSwipe,
  remaining,
}: {
  onSwipe: (a: SwipeAction) => void;
  remaining: number;
}) {
  return (
    <div className="flex items-center justify-center gap-2">
      <Button
        variant="outline"
        size="lg"
        onClick={() => onSwipe("drop")}
        className="h-12 w-12 rounded-full p-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
        title="Drop (←)"
      >
        <Trash2 className="h-5 w-5" />
      </Button>
      <Button
        variant="outline"
        size="lg"
        onClick={() => onSwipe("backlog")}
        className="h-12 w-12 rounded-full p-0"
        title="Backlog (↑)"
      >
        <ArrowUp className="h-5 w-5" />
      </Button>
      <Button
        variant="outline"
        size="lg"
        onClick={() => onSwipe("snooze")}
        className="h-12 w-12 rounded-full p-0"
        title="Snooze 24h (↓)"
      >
        <ArrowDown className="h-5 w-5" />
      </Button>
      <Button
        size="lg"
        onClick={() => onSwipe("approve")}
        className="h-12 w-12 rounded-full p-0 bg-emerald-500 text-white hover:bg-emerald-600"
        title="Approve (→)"
      >
        <Check className="h-5 w-5" />
      </Button>
      <span className="ml-3 text-[11px] text-muted-foreground">
        {remaining} left
      </span>
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

function DoneScreen({ onClose, count }: { onClose: () => void; count: number }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useGSAP(
    () => {
      if (ref.current) heroEntry(ref.current);
    },
    { scope: ref }
  );
  return (
    <div ref={ref} className="space-y-4 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/15">
        <Sparkles className="h-6 w-6 text-primary" />
      </div>
      <h2 className="text-xl font-semibold">Deck cleared</h2>
      <p className="text-sm text-muted-foreground">
        Reviewed {count} {count === 1 ? "item" : "items"}.
      </p>
      <Button onClick={onClose}>Back to board</Button>
    </div>
  );
}

function vectorFor(action: SwipeAction): { x: number; y: number } {
  switch (action) {
    case "approve":
      return { x: 1, y: 0 };
    case "drop":
      return { x: -1, y: 0 };
    case "backlog":
      return { x: 0, y: -1 };
    case "snooze":
      return { x: 0, y: 1 };
  }
}

function normalize(v: { x: number; y: number }): { x: number; y: number } {
  const mag = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / mag, y: v.y / mag };
}
