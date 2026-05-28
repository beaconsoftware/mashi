"use client";

import { useEffect, useRef, useState } from "react";
import { useGSAP } from "@gsap/react";
import {
  Send,
  Scale,
  GitBranch,
  Eye,
  MessageCircle,
  CalendarPlus,
  Check,
  SkipForward,
  ArchiveRestore,
  Clock,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { gsap, DUR, EASE, withMotion } from "@/lib/animation";
import { cn } from "@/lib/utils";
import type { SlotExit } from "@/components/sprint/canvases/_shared/canvas-shell";
import type { SpawnedArtifact } from "@/store/spawned-rail-store";

/**
 * Acknowledgement micro-state shown when a slot exits, before the next
 * queued block promotes into the freed slot. Runs the GSAP timeline
 * spec'd in Phase 6:
 *
 *   - 0-200ms:  outgoing canvas scales to 0.97 + fades to 0.4 (the
 *               canvas behind us; we just mount on top with a dim).
 *   - 100-600ms: ack content scales in from 0.9 with EASE.back.
 *   - 1400-1600ms: ack content fades out, onComplete fires.
 *
 * For users with `prefers-reduced-motion: reduce`, we skip animation
 * entirely and hold the ack visible for 800ms before completing — they
 * still get the "what happened" beat without the morph.
 */

export interface AcknowledgementProps {
  kind: SlotExit["kind"];
  summary: string;
  spawned?: SpawnedArtifact[];
  onComplete: () => void;
}

const HOLD_MS_MOTION = 1400;
const HOLD_MS_REDUCED = 800;
const FADE_OUT_MS = 200;

export function Acknowledgement({
  kind,
  summary,
  spawned,
  onComplete,
}: AcknowledgementProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const firedRef = useRef(false);
  // Stash onComplete in a ref so the timer effect can read the latest
  // callback without depending on it. Without this, the parent's 1s
  // sprint clock tick rebuilds the onComplete closure every second, the
  // effect re-runs every second, the timer clears + restarts every
  // second, and the 1600ms completion deadline is never reached — the
  // ack card freezes on screen and the queued item never promotes.
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const reduced = useReducedMotion();

  useGSAP(
    () => {
      if (!cardRef.current) return;
      if (reduced) {
        // Reduced motion: no scale/fade; just hold for HOLD_MS_REDUCED.
        return;
      }
      withMotion(() => {
        gsap.fromTo(
          cardRef.current,
          { opacity: 0, scale: 0.9 },
          {
            opacity: 1,
            scale: 1,
            duration: DUR.base,
            ease: EASE.back,
            delay: 0.1,
          }
        );
      });
    },
    { scope: cardRef, dependencies: [reduced] }
  );

  useEffect(() => {
    if (firedRef.current) return;
    const hold = reduced ? HOLD_MS_REDUCED : HOLD_MS_MOTION;
    const fadeAt = hold;
    const completeAt = hold + (reduced ? 0 : FADE_OUT_MS);

    const fadeTimer = setTimeout(() => {
      if (!cardRef.current || reduced) return;
      withMotion(() => {
        gsap.to(cardRef.current, {
          opacity: 0,
          scale: 0.96,
          duration: FADE_OUT_MS / 1000,
          ease: EASE.outQuick,
        });
      });
    }, fadeAt);

    const completeTimer = setTimeout(() => {
      if (firedRef.current) return;
      firedRef.current = true;
      onCompleteRef.current();
    }, completeAt);

    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(completeTimer);
    };
  }, [reduced]);

  const tint = tintFor(kind);

  return (
    <div
      className={cn(
        "absolute inset-0 z-20 flex items-center justify-center",
        "bg-background/60 backdrop-blur-sm"
      )}
      aria-live="polite"
      aria-label="Slot complete"
    >
      <div
        ref={cardRef}
        className={cn(
          "max-w-[80%] rounded-xl border bg-card/95 px-5 py-4 text-center shadow-xl",
          tint.border
        )}
      >
        <div className={cn("mx-auto mb-2 inline-flex h-9 w-9 items-center justify-center rounded-full", tint.bg)}>
          <AckIcon kind={kind} className={cn("h-4 w-4", tint.fg)} />
        </div>
        <div className="text-[13px] font-semibold text-foreground">
          {summary}
        </div>
        {spawned && spawned.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Spawned
            </span>
            {spawned.map((a) => (
              <span
                key={a.id}
                className="rounded border border-border/40 bg-secondary/40 px-1.5 py-0.5 text-[10px] text-foreground/80"
              >
                {a.label}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AckIcon({
  kind,
  className,
}: {
  kind: SlotExit["kind"];
  className?: string;
}) {
  switch (kind) {
    case "send":
      return <Send className={className} />;
    case "decide":
      return <Scale className={className} />;
    case "check-in":
      return <Eye className={className} />;
    case "nudge-delegate":
      return <MessageCircle className={className} />;
    case "stage-meeting":
      return <CalendarPlus className={className} />;
    case "done":
      return <Check className={className} />;
    case "skip":
      return <SkipForward className={className} />;
    case "bench":
      return <ArchiveRestore className={className} />;
    case "snooze":
      return <Clock className={className} />;
    case "repathway":
      return <RefreshCw className={className} />;
    default:
      return <Sparkles className={className} />;
  }
}

function tintFor(kind: SlotExit["kind"]): {
  border: string;
  bg: string;
  fg: string;
} {
  switch (kind) {
    case "send":
      return {
        border: "border-emerald-500/40",
        bg: "bg-emerald-500/15",
        fg: "text-emerald-300",
      };
    case "decide":
      return {
        border: "border-primary/40",
        bg: "bg-primary/15",
        fg: "text-primary",
      };
    case "check-in":
      return {
        border: "border-sky-500/40",
        bg: "bg-sky-500/15",
        fg: "text-sky-300",
      };
    case "stage-meeting":
      return {
        border: "border-violet-500/40",
        bg: "bg-violet-500/15",
        fg: "text-violet-300",
      };
    case "nudge-delegate":
      return {
        border: "border-fuchsia-500/40",
        bg: "bg-fuchsia-500/15",
        fg: "text-fuchsia-300",
      };
    case "done":
      return {
        border: "border-emerald-500/40",
        bg: "bg-emerald-500/15",
        fg: "text-emerald-300",
      };
    case "repathway":
      return {
        border: "border-amber-500/40",
        bg: "bg-amber-500/15",
        fg: "text-amber-300",
      };
    default:
      return {
        border: "border-border/40",
        bg: "bg-secondary/60",
        fg: "text-muted-foreground",
      };
  }
}

function useReducedMotion(): boolean {
  // Initialize from the media query synchronously when running in the
  // browser so the first render already reflects the user's preference —
  // avoids an animation flicker for reduced-motion users on first mount.
  const [reduced, setReduced] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = () => setReduced(mq.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return reduced;
}
