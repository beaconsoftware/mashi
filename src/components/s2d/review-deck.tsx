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
  CheckCircle2,
  Trash2,
  ArrowDown,
  ArrowUp,
  X,
  Keyboard,
  Loader2,
  ExternalLink,
  Link as LinkIcon,
  AlertTriangle,
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
import { allSources, deriveSourceUrl, type SourceRef } from "@/lib/sources/url";

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
 * Render strategy: one card visible at a time, keyed by item.id so each
 * new card remounts cleanly. We previously kept a 3-card peek behind
 * the top card, but the parallel "fly top off" + "animate next forward"
 * tweens raced against the cursor advance — the next-card tween would
 * outlive the cursor update and re-grow the wrong item, producing the
 * "three overlapping cards" rendering bug. Single-card is dumb and
 * reliable.
 */

interface Props {
  items: S2DItem[];
  open: boolean;
  onClose: () => void;
}

/**
 * Five outcomes per card:
 *   approve  → approved + lands in agent-recommended status (default)
 *   drop     → closed with outcome "Dropped before review"
 *   backlog  → approved but forced to backlog
 *   snooze   → approved but in_queue + snoozed_until = +24h
 *   done     → approved AND immediately marked done (handled elsewhere
 *              and just needs to clear out of the review pile)
 *
 * `done` is the "I already did this / don't need to act, just clear it"
 * shortcut so a glance at the review pile doesn't force routing items
 * through the active board first.
 */
type SwipeAction = "approve" | "drop" | "backlog" | "snooze" | "done";

export function ReviewDeck({ items, open, onClose }: Props) {
  const updateItem = useUpdateS2DItem();
  const [cursor, setCursor] = useState(0);
  // Per-item user overrides — collected on the visible card, applied on swipe.
  const [overrides, setOverrides] = useState<
    Record<string, { priority?: Priority; pathway?: Pathway; status?: S2DStatus }>
  >({});
  const [justifying, setJustifying] = useState(false);
  // Inline banner — surfaces failed swipe PATCHes so a network blip doesn't
  // silently roll back the cache while the cursor keeps advancing.
  const [banner, setBanner] = useState<{ kind: "err"; msg: string } | null>(null);
  useEffect(() => {
    if (!banner) return;
    const id = setTimeout(() => setBanner(null), 8000);
    return () => clearTimeout(id);
  }, [banner]);

  // Snapshot the deck order when opened so swipes don't reshuffle mid-session.
  // Snapshotting happens synchronously during render the moment `open` flips
  // true — NOT inside a useEffect — because a post-commit effect leaves the
  // first paint with deckRef.current === [], which makes validIndices === []
  // and renders the DoneScreen flash before any card appears. Tracking the
  // previous open state via a ref lets us detect the transition in render
  // without thrashing on every items prop change.
  //
  // `items` is intentionally NOT in the cursor-reset effect's deps. Without
  // that, every optimistic cache mutation from useUpdateS2DItem (which flips
  // needs_review=false on swipe) re-renders the parent, passes a new items
  // array, and resets the cursor to 0 mid-deck — counter stuck at "1 / N"
  // forever. The snapshot is pinned once on open; per-item live updates flow
  // through liveItemsById below.
  const deckRef = useRef<S2DItem[]>([]);
  const lastOpenRef = useRef(false);
  if (open && !lastOpenRef.current) {
    deckRef.current = items.slice();
  }
  lastOpenRef.current = open;
  useEffect(() => {
    if (open) {
      setCursor(0);
      setOverrides({});
    }
  }, [open]);

  // Live lookup over the most recent items prop. The deck *order* is
  // pinned by the snapshot in deckRef, but per-item fields like
  // review_justification (filled in by /api/s2d/justify and pulled in
  // via TanStack Query refetch) need to show through. Without this,
  // the "Generating justification…" placeholder stayed forever even
  // after the backend wrote the real text.
  const liveItemsById = useMemo(
    () => new Map(items.map((it) => [it.id, it])),
    [items]
  );

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

  // The deck's snapshot is pinned on open so swipes don't reshuffle mid-
  // session, but if a background sync closes an item or flips its
  // needs_review flag while the user is mid-deck, we need to skip past it
  // — otherwise an "approve" swipe writes status="<override>" against a
  // row that's already status="done", overwriting the auto-close outcome.
  // Build the list of snapshot indices that are still actionable. The
  // cursor walks this list rather than the raw snapshot — so a
  // background-closed item is silently skipped instead of stalling the
  // deck on a stale card.
  const validIndices = useMemo(() => {
    return deckRef.current
      .map((it, i) => {
        const live = liveItemsById.get(it.id);
        // Keep snapshot fallback if the live row is missing (could be a
        // race where the row hasn't refetched yet); otherwise filter out
        // anything already closed or no-longer flagged for review.
        if (!live) return i;
        if (live.status === "done") return null;
        if (live.needs_review !== true) return null;
        return i;
      })
      .filter((i): i is number => i != null);
  }, [liveItemsById]);
  const remaining = Math.max(0, validIndices.length - cursor);
  const currentSnapshotIndex = validIndices[cursor];
  const currentSnapshot =
    currentSnapshotIndex != null ? deckRef.current[currentSnapshotIndex] : undefined;
  const current = currentSnapshot
    ? liveItemsById.get(currentSnapshot.id) ?? currentSnapshot
    : undefined;

  const topCardRef = useRef<HTMLDivElement | null>(null);
  // Guard against double-swipes while the top card is still flying off.
  // If the user spam-clicks Approve, only the first one should land.
  const swipingRef = useRef(false);
  // Pending safety timeout — stored on a ref so we can cancel it from
  // multiple places: a subsequent flyOff, the gsap onComplete, AND on
  // component unmount. Earlier version only cleared inside onComplete,
  // which meant a tween killed by killTweensOf would leave the timeout
  // pending → applySwipe fires a second time → cursor double-advances.
  const safetyRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearSafety() {
    if (safetyRef.current) {
      clearTimeout(safetyRef.current);
      safetyRef.current = null;
    }
  }

  // Clean up any pending safety on unmount/close so we don't fire
  // applySwipe + setCursor on a torn-down component.
  useEffect(() => {
    return clearSafety;
  }, []);

  const applySwipe = useCallback(
    (action: SwipeAction) => {
      if (!current) return;
      const swipedItem = current;
      const swipedId = swipedItem.id;
      const ticket = swipedItem.ticket_number;
      try {
        const o = overrides[swipedId] ?? {};
        const priority = o.priority ?? swipedItem.priority;
        const pathway = o.pathway ?? swipedItem.pathway;
        let status: S2DStatus = o.status ?? swipedItem.status;

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
        } else if (action === "done") {
          patch.needs_review = false;
          patch.status = "done";
          patch.outcome = "Done from review (handled elsewhere)";
          patch.resolved_via = "manual";
        }

        // mutateAsync surfaces save failures via banner so a network blip
        // doesn't silently roll back the cache after the card has already
        // flown off. The optimistic onMutate keeps the swipe feeling instant.
        updateItem.mutateAsync({ id: swipedId, patch }).catch((err) => {
          setBanner({
            kind: "err",
            msg: `Couldn't save MASH-${ticket}: ${
              err instanceof Error ? err.message : "save failed"
            } — it's back in Review, retry from there`,
          });
        });
        // Drop the swiped override so the map doesn't grow unbounded
        // over a long session.
        setOverrides((prev) => {
          if (!(swipedId in prev)) return prev;
          const { [swipedId]: _drop, ...rest } = prev;
          void _drop;
          return rest;
        });
      } catch (err) {
        // Don't let an unexpected throw wedge the deck on this card —
        // surface the error and advance anyway.
        console.error("[review-deck] applySwipe failed:", err);
      } finally {
        setCursor((c) => c + 1);
      }
    },
    [current, overrides, updateItem]
  );

  // ───────────────────────────── Pointer drag ─────────────────────────────
  const dragState = useRef({ x: 0, y: 0, dragging: false });

  const flyOff = useCallback(
    (action: SwipeAction, dir: { x: number; y: number }) => {
      if (!topCardRef.current) return;
      if (swipingRef.current) return; // guard: already animating
      swipingRef.current = true;
      const card = topCardRef.current;
      // Kill any in-flight tween on this card so a fresh fly-off isn't
      // racing the drag-snap-back or anything else.
      gsap.killTweensOf(card);
      // Also clear any pending safety from a previous flyOff. Without
      // this, killTweensOf above silently prevents the previous
      // onComplete from running → its `clearTimeout` never fires →
      // the old safety eventually triggers applySwipe a SECOND time,
      // double-advancing the cursor and skipping a card. (Critical
      // bug found in audit.)
      clearSafety();
      const vec = normalize(dir);
      const distance = 800;
      const rot = dir.x * 0.08;

      // Safety net: if gsap onComplete somehow doesn't fire (killed tween,
      // animation queue lost, prefers-reduced-motion edge), force-advance
      // after 600ms so the deck can't get permanently wedged on "swipingRef
      // stays true forever".
      safetyRef.current = setTimeout(() => {
        if (swipingRef.current) {
          safetyRef.current = null;
          applySwipe(action);
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
          applySwipe(action);
          // Releasing after applySwipe means the next card (which mounts
          // fresh due to key=current.id) is interactable immediately.
          swipingRef.current = false;
        },
      });
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

  // ENTRY ANIMATIONS DELIBERATELY REMOVED.
  //
  // Both `gsap.from(rootRef, opacity: 0)` and `heroEntry(card)` tween
  // opacity from 0 to 1. The card uses DUR.hero = 0.7s. For the entire
  // duration of that tween (700ms after every cursor advance), the
  // card is partially transparent and the board behind shows through
  // the opaque backdrop's edges — that's the "card translucent after
  // swipe" symptom the user kept reporting.
  //
  // No opacity tweens on this component anymore. Modal pops in
  // instantly; new cards pop in instantly. The progress bar + remaining
  // counter + swipe gesture itself carry enough motion that the user
  // doesn't lose track of "a new card arrived". Correctness > polish.

  // Card transforms reset automatically because the CardFace below is
  // keyed by current.id — each new card mounts as a fresh DOM element
  // with no inline transforms, then heroEntry animates it in cleanly.

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
        {banner && (
          <div className="mb-3 flex items-start gap-2 rounded border border-destructive/40 bg-destructive/10 p-2.5 text-[12px] text-destructive">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="flex-1">{banner.msg}</span>
            <button
              onClick={() => setBanner(null)}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        {/* Top: progress + close */}
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
            {Math.min(cursor + 1, validIndices.length)} / {validIndices.length}
          </span>
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-secondary/40">
            <div
              className="h-full bg-primary transition-all"
              style={{
                width: `${validIndices.length === 0 ? 100 : (Math.min(cursor + 1, validIndices.length) / validIndices.length) * 100}%`,
              }}
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

        {/* Deck — single card render. The "visible stack" illusion is
            done via two static drop-shadow lines on the bottom of the
            card itself (see CardFace), not real card DOM nodes. After
            multiple attempts to make a 3-card stack reliable I'm
            keeping this dead simple: one card in the DOM at any time.
            "94 left" counter and the swipe progress bar communicate
            "there's more behind" without us having to render extra
            cards that keep finding new ways to bleed through. */}
        <div className="relative isolate my-6 flex-1 min-h-0 select-none">
          <CardFace
            key={current.id}
            item={current}
            cardRef={topCardRef}
            interactive
            // Two stacked drop-shadows render as faint card edges
            // peeking below — pure CSS, zero real card content behind.
            style={{
              zIndex: 3,
              boxShadow:
                "0 8px 24px -4px hsl(0 0% 0% / 0.5), 0 12px 0 -4px hsl(240 8% 7% / 1), 0 12px 1px -4px hsl(240 5% 25% / 0.4), 0 22px 0 -8px hsl(240 8% 7% / 1), 0 22px 1px -8px hsl(240 5% 25% / 0.25)",
            }}
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
      className="fixed inset-0 z-[110] flex items-center justify-center"
      // Inline color — defensive against any Tailwind class collision /
      // global CSS that might otherwise leave the overlay transparent.
      // hsl(240 10% 4%) matches the dashboard's --background, fully
      // opaque. No alpha. No bleed-through possible at the backdrop
      // layer.
      style={{ backgroundColor: "hsl(240 10% 4%)" }}
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
  cardRef?: React.RefObject<HTMLDivElement | null>;
  style?: React.CSSProperties;
  className?: string;
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
  className,
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
        dim && "opacity-70",
        className
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
              Action type: {pathwayMeta.label}
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

        <SourcesSection item={item} />

        {/* Inline overrides */}
        {interactive && setOverride && (
          <div className="grid grid-cols-3 gap-2 text-[11px]">
            <label className="space-y-1">
              <span className="block text-[9px] uppercase tracking-wider text-muted-foreground">
                Priority
              </span>
              <select
                value={priority}
                onChange={(e) => {
                  setOverride({ priority: e.target.value as Priority });
                  // Blur so arrow keys go back to deck swipes (otherwise
                  // ArrowRight is swallowed by the keyboard guard until
                  // the user clicks off the select).
                  e.target.blur();
                }}
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
                onChange={(e) => {
                  setOverride({ pathway: e.target.value as Pathway });
                  e.target.blur();
                }}
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
                onChange={(e) => {
                  setOverride({ status: e.target.value as S2DStatus });
                  e.target.blur();
                }}
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

/**
 * "Sources" section on the review card — clickable chips for the primary
 * source + every linked source. Each chip is an external link when we
 * can build one; unlinked chips show as plain badges. The intent is
 * "click to inspect" — opens Gmail / Slack / Linear / Fireflies in a
 * new tab so the user can see the full context that triggered the item.
 */
function SourcesSection({
  item,
}: {
  item: Pick<
    S2DItem,
    "source_type" | "source_thread_id" | "source_label" | "source_url" | "linked_sources"
  >;
}) {
  const sources = allSources({
    source_type: item.source_type ?? null,
    source_thread_id: item.source_thread_id,
    source_label: item.source_label,
    source_url: item.source_url,
    linked_sources: item.linked_sources,
  });
  if (sources.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <LinkIcon className="h-3 w-3" />
        Sources
        <span className="font-mono opacity-70">{sources.length}</span>
      </div>
      <ul className="flex flex-col gap-1.5">
        {sources.map((src, i) => (
          <SourceChip key={`${src.source_type}-${src.source_thread_id}-${i}`} src={src} />
        ))}
      </ul>
    </div>
  );
}

function SourceChip({ src }: { src: SourceRef }) {
  const url = deriveSourceUrl(src);
  const label = src.source_label ?? `${src.source_type ?? "source"}: ${src.source_thread_id ?? "?"}`;
  const inner = (
    <>
      {src.source_type && (
        <SourceIcon type={src.source_type as S2DItem["source_type"] as never} />
      )}
      <span className="flex-1 truncate text-[12px] text-foreground/85">{label}</span>
      {url ? (
        <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
      ) : (
        <span className="shrink-0 rounded bg-secondary px-1 py-0.5 font-mono text-[9px] text-muted-foreground/70">
          no link
        </span>
      )}
    </>
  );
  const classes =
    "flex items-center gap-2 rounded-md border border-border/40 bg-background/40 px-2.5 py-1.5 transition-colors";
  if (url) {
    return (
      <li>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(classes, "hover:border-border hover:bg-accent/30")}
        >
          {inner}
        </a>
      </li>
    );
  }
  return (
    <li>
      <div className={cn(classes, "cursor-default opacity-70")} title="No deep link available — search in the source app">
        {inner}
      </div>
    </li>
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
        variant="outline"
        size="lg"
        onClick={() => onSwipe("done")}
        className="h-12 w-12 rounded-full p-0 border-emerald-500/60 text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300"
        title="Already done — clear from review"
      >
        <CheckCircle2 className="h-5 w-5" />
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
    case "done":
      // Fly down-right — a blend of approve (right) and snooze-direction
      // (down). No keyboard/swipe binding for this, so the vector only
      // matters for the button-press fly-off animation.
      return { x: 1, y: 1 };
  }
}

function normalize(v: { x: number; y: number }): { x: number; y: number } {
  const mag = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / mag, y: v.y / mag };
}
