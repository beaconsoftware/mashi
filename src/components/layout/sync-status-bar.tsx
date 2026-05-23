"use client";

import { Check, AlertTriangle, X, Sparkles } from "lucide-react";
import { useSyncStore } from "@/store/sync-store";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { useGSAP } from "@gsap/react";
import { gsap, EASE, slideDown, withMotion } from "@/lib/animation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Persistent header that shows sync progress across every dashboard page.
 *
 * Visible whenever:
 *   - A sync is running (live "breathing" loader + animated progress)
 *   - A sync just finished (shows result, dismissable)
 *
 * Visuals:
 *   - Syncing: gradient progress fill with a traveling shimmer; the loader
 *     dot pulses (breathes) on a sine-wave yoyo; a soft glow ring also
 *     pulses around the dot to telegraph "live, alive, working" without
 *     using a spinning loader (which reads as "frozen waiting").
 *   - Success: green check tints in, single bright pulse, then auto-fades.
 *   - Error: amber/red bar with an attention pulse so it can't be missed.
 *
 * Reduced-motion respected via withMotion in @/lib/animation.
 */
export function SyncStatusBar() {
  const router = useRouter();
  const isSyncing = useSyncStore((s) => s.isSyncing);
  const progress = useSyncStore((s) => s.progress);
  const lastResult = useSyncStore((s) => s.lastResult);
  const clearResult = useSyncStore((s) => s.clearResult);
  const wasSyncingRef = useRef(false);

  // Refresh server data after sync finishes so the new S2D rows show up
  // without the user having to reload.
  useEffect(() => {
    if (wasSyncingRef.current && !isSyncing) {
      router.refresh();
    }
    wasSyncingRef.current = isSyncing;
  }, [isSyncing, router]);

  return (
    <SyncStatusBarInner
      isSyncing={isSyncing}
      progress={progress}
      lastResult={lastResult}
      clearResult={clearResult}
    />
  );
}

function SyncStatusBarInner({
  isSyncing,
  progress,
  lastResult,
  clearResult,
}: {
  isSyncing: boolean;
  progress: { current: number; total: number; label: string } | null;
  lastResult: { kind: "ok" | "err"; msg: string } | null;
  clearResult: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const visible = isSyncing || !!lastResult;

  // Slide-down entry whenever the bar appears.
  useGSAP(
    () => {
      if (!visible || !wrapRef.current) return;
      slideDown(wrapRef.current);
    },
    { dependencies: [visible], scope: wrapRef }
  );

  if (!visible) return null;

  if (isSyncing && progress) {
    return <SyncingBar wrapRef={wrapRef} progress={progress} />;
  }

  if (lastResult) {
    return (
      <ResultBar wrapRef={wrapRef} lastResult={lastResult} onClear={clearResult} />
    );
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// Syncing state — gradient progress, traveling shimmer, breathing dot.
// ─────────────────────────────────────────────────────────────────────────

function SyncingBar({
  wrapRef,
  progress,
}: {
  wrapRef: React.RefObject<HTMLDivElement | null>;
  progress: { current: number; total: number; label: string };
}) {
  const fillRef = useRef<HTMLDivElement | null>(null);
  const shimmerRef = useRef<HTMLDivElement | null>(null);
  const dotRef = useRef<HTMLDivElement | null>(null);
  const haloRef = useRef<HTMLDivElement | null>(null);

  // Tween the fill width as progress advances. Width tween (not transform)
  // because the shimmer overlay needs a real layout box to slide across.
  useGSAP(
    () => {
      if (!fillRef.current || progress.total === 0) return;
      const pct = Math.min(100, (progress.current / progress.total) * 100);
      gsap.to(fillRef.current, {
        width: `${pct}%`,
        duration: 0.6,
        ease: EASE.out,
      });
    },
    { dependencies: [progress.current, progress.total] }
  );

  // Traveling shimmer across the fill — a 12% wide highlight band that
  // sweeps left-to-right on a 2s repeat. Anchored to the fill (not the
  // full bar) so it visually tracks the progress.
  useGSAP(
    () => {
      if (!shimmerRef.current) return;
      withMotion(() => {
        gsap.fromTo(
          shimmerRef.current,
          { xPercent: -200 },
          {
            xPercent: 600,
            duration: 1.8,
            ease: "power1.inOut",
            repeat: -1,
          }
        );
      });
    },
    { scope: wrapRef }
  );

  // Breathing dot — sine-wave scale tween. Sits where a spinner would.
  // Reads as a heartbeat, not a frozen waiting state.
  useGSAP(
    () => {
      if (!dotRef.current) return;
      withMotion(() => {
        gsap.to(dotRef.current, {
          scale: 1.35,
          duration: 0.9,
          repeat: -1,
          yoyo: true,
          ease: "sine.inOut",
        });
      });
    },
    { scope: wrapRef }
  );

  // Halo ring around the dot — expands + fades on a slower cycle so it
  // overlaps the dot pulse out of phase. Gives the dot a "radiating"
  // feel without using GIFs or extra DOM nodes per frame.
  useGSAP(
    () => {
      if (!haloRef.current) return;
      withMotion(() => {
        gsap.fromTo(
          haloRef.current,
          { scale: 0.8, opacity: 0.55 },
          {
            scale: 2.2,
            opacity: 0,
            duration: 1.6,
            repeat: -1,
            ease: "power2.out",
          }
        );
      });
    },
    { scope: wrapRef }
  );

  const pct = progress.total === 0 ? 0 : (progress.current / progress.total) * 100;

  return (
    <div
      ref={wrapRef}
      className="relative overflow-hidden border-b border-primary/20 bg-gradient-to-r from-card/85 via-primary/[0.04] to-card/85 backdrop-blur-md"
    >
      {/* subtle backdrop sheen, fixed (doesn't loop) */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-primary/5 to-transparent" />

      <div className="relative flex items-center gap-3 px-4 py-2 text-sm">
        {/* Breathing dot + halo */}
        <div className="relative flex h-4 w-4 items-center justify-center">
          <div
            ref={haloRef}
            className="absolute inset-0 rounded-full bg-primary/40"
            style={{ filter: "blur(2px)" }}
          />
          <div
            ref={dotRef}
            className="relative h-2 w-2 rounded-full bg-primary shadow-[0_0_12px_hsl(var(--primary)/0.7)]"
          />
        </div>

        <span className="font-medium tracking-tight">Syncing</span>
        <span className="text-foreground/30">·</span>
        <span className="truncate text-foreground/85">{progress.label}</span>
        <span className="ml-auto flex items-center gap-2 whitespace-nowrap text-[11px] tabular-nums text-foreground/60">
          <span className="font-mono">
            {progress.current} / {progress.total}
          </span>
          <span className="rounded bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-primary">
            {Math.round(pct)}%
          </span>
        </span>
      </div>

      {/* Progress fill with traveling shimmer */}
      <div className="relative h-[3px] w-full bg-border/40">
        <div
          ref={fillRef}
          className="relative h-full overflow-hidden bg-gradient-to-r from-primary/70 via-primary to-primary/70"
          style={{ width: 0, boxShadow: "0 0 8px hsl(var(--primary) / 0.55)" }}
        >
          <div
            ref={shimmerRef}
            className="absolute inset-y-0 w-[20%] bg-gradient-to-r from-transparent via-white/60 to-transparent"
            style={{ filter: "blur(1px)" }}
          />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Result state — success/error toast, single attention pulse.
// ─────────────────────────────────────────────────────────────────────────

function ResultBar({
  wrapRef,
  lastResult,
  onClear,
}: {
  wrapRef: React.RefObject<HTMLDivElement | null>;
  lastResult: { kind: "ok" | "err"; msg: string };
  onClear: () => void;
}) {
  const iconRef = useRef<HTMLDivElement | null>(null);
  const isErr = lastResult.kind === "err";

  // Single attention pulse on the icon (more attention-grabbing for
  // errors, a quick congratulatory pop for success).
  useGSAP(
    () => {
      if (!iconRef.current) return;
      withMotion(() => {
        gsap.fromTo(
          iconRef.current,
          { scale: 0.6, opacity: 0 },
          { scale: 1, opacity: 1, duration: 0.35, ease: EASE.back }
        );
        if (isErr) {
          gsap.to(iconRef.current, {
            scale: 1.12,
            duration: 0.7,
            repeat: 3,
            yoyo: true,
            ease: "sine.inOut",
            delay: 0.35,
          });
        }
      });
    },
    { scope: wrapRef, dependencies: [lastResult.msg, isErr] }
  );

  return (
    <div
      ref={wrapRef}
      className={cn(
        "flex items-center gap-2 border-b px-4 py-2 text-sm backdrop-blur-md transition-colors",
        isErr
          ? "border-red-500/30 bg-red-500/10 text-red-100"
          : "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
      )}
    >
      <div ref={iconRef} className="flex h-4 w-4 shrink-0 items-center justify-center">
        {isErr ? (
          <AlertTriangle className="h-4 w-4" />
        ) : (
          <Check className="h-4 w-4" />
        )}
      </div>
      <span className="truncate">{lastResult.msg}</span>
      {!isErr && <Sparkles className="h-3 w-3 shrink-0 opacity-60" />}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onClear}
        aria-label="Dismiss"
        className="mashi-icon-glow ml-auto h-5 w-5 rounded p-0.5 opacity-60 hover:bg-foreground/10 hover:opacity-100"
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
