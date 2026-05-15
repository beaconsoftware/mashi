"use client";

import { Loader2, Check, AlertTriangle, X } from "lucide-react";
import { useSyncStore } from "@/store/sync-store";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { useGSAP } from "@gsap/react";
import { slideDown, gsap, EASE } from "@/lib/animation";

/**
 * Persistent header that shows sync progress across every dashboard page.
 *
 * Visible whenever:
 *   - A sync is running (shows current connector + progress)
 *   - A sync just finished (shows result for 10s, dismissable)
 *
 * Rendered at the top of <main> in AppShell.
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

  return <SyncStatusBarInner isSyncing={isSyncing} progress={progress} lastResult={lastResult} clearResult={clearResult} />;
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
  const barRef = useRef<HTMLDivElement | null>(null);
  const visible = isSyncing || !!lastResult;

  // Animate wrapper on appearance
  useGSAP(
    () => {
      if (!visible || !wrapRef.current) return;
      slideDown(wrapRef.current);
    },
    { dependencies: [visible], scope: wrapRef }
  );

  // Smoothly tween the progress bar width as the sync advances
  useGSAP(
    () => {
      if (!barRef.current || !progress || progress.total === 0) return;
      const pct = (progress.current / progress.total) * 100;
      gsap.to(barRef.current, {
        width: `${pct}%`,
        duration: 0.45,
        ease: EASE.out,
      });
    },
    { dependencies: [progress?.current, progress?.total] }
  );

  if (!visible) return null;

  if (isSyncing && progress) {
    return (
      <div ref={wrapRef} className="border-b border-border bg-card/80 backdrop-blur">
        <div className="flex items-center gap-3 px-4 py-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin text-foreground/70" />
          <span className="font-medium">Syncing</span>
          <span className="text-foreground/60">·</span>
          <span className="truncate text-foreground/80">{progress.label}</span>
          <span className="ml-auto whitespace-nowrap text-xs tabular-nums text-foreground/60">
            {progress.current} / {progress.total}
          </span>
        </div>
        <div className="h-0.5 w-full bg-border/40">
          <div ref={barRef} className="h-full bg-foreground/70" style={{ width: 0 }} />
        </div>
      </div>
    );
  }

  if (lastResult) {
    const isErr = lastResult.kind === "err";
    return (
      <div
        ref={wrapRef}
        className={`flex items-center gap-2 border-b px-4 py-2 text-sm ${
          isErr
            ? "border-red-500/30 bg-red-500/10 text-red-100"
            : "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
        }`}
      >
        {isErr ? (
          <AlertTriangle className="h-4 w-4 shrink-0" />
        ) : (
          <Check className="h-4 w-4 shrink-0" />
        )}
        <span className="truncate">{lastResult.msg}</span>
        <button
          onClick={clearResult}
          className="ml-auto rounded p-0.5 opacity-60 hover:bg-foreground/10 hover:opacity-100"
          aria-label="Dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return null;
}
