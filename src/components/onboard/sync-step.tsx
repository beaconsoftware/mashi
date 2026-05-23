"use client";

// translucency-audit-ok: file — legacy callsites, migrate to sanctioned scale (/15, /40, /55, /60, /80, /95) case-by-case during component touch-ups.

import { useEffect, useRef, useState } from "react";
import { useGSAP } from "@gsap/react";
import { Loader2, AlertTriangle, Sparkles, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OnboardingShell } from "@/components/onboard/onboarding-shell";
import { Aurora } from "@/components/onboard/aurora";
import { MashiMark } from "@/components/shared/mashi-mark";
import { useSyncStore } from "@/store/sync-store";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { gsap, withMotion } from "@/lib/animation";

interface ConnectionLite {
  id: string;
  provider: "linear" | "gmail" | "slack" | "fireflies" | "gcal" | "outlook" | "mscal";
  account_label: string;
}

interface Props {
  cleanupRanAt: string | null;
}

type Phase = "idle" | "syncing" | "cleaning" | "done" | "error";

const PROVIDER_GLYPHS: Record<string, { letter: string; color: string }> = {
  linear: { letter: "L", color: "hsl(248 70% 65%)" },
  gmail: { letter: "G", color: "hsl(0 75% 60%)" },
  slack: { letter: "S", color: "hsl(330 80% 60%)" },
  fireflies: { letter: "F", color: "hsl(20 85% 60%)" },
  gcal: { letter: "C", color: "hsl(210 80% 60%)" },
  outlook: { letter: "O", color: "hsl(220 75% 60%)" },
  mscal: { letter: "M", color: "hsl(195 80% 60%)" },
};

/**
 * Step 5 — first sync + cleanup, visualized as an orbital data flow.
 *
 * Each connected source becomes a glyph orbiting a central core. When
 * the user hits Sync, particles stream from each glyph inward to the
 * core; the core glows brighter as data lands. When cleanup runs,
 * particles fly OUT of the core and dissolve — visual metaphor for
 * stale items being closed.
 */
export function SyncStep({ cleanupRanAt }: Props) {
  const runSyncAll = useSyncStore((s) => s.runSyncAll);
  const isSyncing = useSyncStore((s) => s.isSyncing);
  const progress = useSyncStore((s) => s.progress);

  const [phase, setPhase] = useState<Phase>(cleanupRanAt ? "done" : "idle");
  const [error, setError] = useState<string | null>(null);
  const [cleanupCount, setCleanupCount] = useState<number | null>(null);
  const [connections, setConnections] = useState<ConnectionLite[]>([]);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);

  useEffect(() => {
    const sb = createSupabaseBrowserClient();
    sb.from("connected_accounts")
      .select("id, provider, account_label")
      .then(({ data }) => {
        setConnections(
          (data ?? []).map((c) => ({
            id: c.id,
            provider: c.provider,
            account_label: c.account_label ?? c.provider,
          })) as ConnectionLite[]
        );
      });
  }, []);

  // Elapsed-time ticker so the user has a heartbeat to look at while
  // waiting — proves the page isn't hung even if the progress label
  // hasn't ticked over to the next connector yet.
  useEffect(() => {
    if (phase !== "syncing" && phase !== "cleaning") return;
    const id = setInterval(() => {
      if (startedAt) setElapsedSec(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [phase, startedAt]);

  async function runAll() {
    setError(null);
    setPhase("syncing");
    setStartedAt(Date.now());
    setElapsedSec(0);
    try {
      await runSyncAll(connections);
      setPhase("cleaning");
      const res = await fetch("/api/onboard/cleanup", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "cleanup failed");
      setCleanupCount(data.total ?? 0);
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync + cleanup failed");
      setPhase("error");
    }
  }

  const canAdvance = phase === "done";

  return (
    <OnboardingShell currentStep={5} canAdvance={canAdvance} allowSkip>
      <div className="space-y-3">
        {/* Heads-up — shown only before the user starts, so it sets
            expectations without becoming wallpaper after they hit Go. */}
        {phase === "idle" && (
          <div className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/10 p-3 text-[12px]">
            <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <div className="flex-1">
              <span className="font-semibold text-foreground">
                Heads up — this takes about 2–4 minutes.
              </span>{" "}
              <span className="text-muted-foreground">
                Mashi pulls history from {connections.length} source
                {connections.length === 1 ? "" : "s"} sequentially, then runs an
                AI triage + cleanup pass. You can leave this tab — it&apos;ll keep
                running. Coffee break tier.
              </span>
            </div>
          </div>
        )}

        <SyncStage
          phase={phase}
          connections={connections}
          isSyncing={isSyncing}
          cleanupCount={cleanupCount}
          progress={progress}
          elapsedSec={elapsedSec}
        />

        <div className="flex items-center justify-between gap-3 rounded-md border border-border/40 bg-secondary/20 px-3 py-2">
          <div className="text-[11px] text-muted-foreground">
            <span className="font-semibold text-foreground">Sync is currently manual.</span>{" "}
            Webhook-based realtime is coming. For now, hit sync from the top bar whenever.
          </div>
          {phase === "idle" && (
            <Button type="button" onClick={runAll} disabled={connections.length === 0} size="sm" className="gap-1.5">
              <Sparkles className="h-3.5 w-3.5" />
              Pull everything
            </Button>
          )}
          {(phase === "syncing" || phase === "cleaning") && (
            <span className="inline-flex items-center gap-1.5 text-[12px] text-primary">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {phase === "syncing" ? "Syncing…" : "Cleaning…"}
            </span>
          )}
          {phase === "error" && (
            <button
              onClick={runAll}
              className="inline-flex items-center gap-1.5 text-[12px] text-destructive hover:underline"
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              Retry
            </button>
          )}
        </div>

        {error && (
          <div className="text-[11px] text-destructive">{error}</div>
        )}
      </div>
    </OnboardingShell>
  );
}

// ============================================================================
// The animated stage
// ============================================================================

function SyncStage({
  phase,
  connections,
  isSyncing,
  cleanupCount,
  progress,
  elapsedSec,
}: {
  phase: Phase;
  connections: ConnectionLite[];
  isSyncing: boolean;
  cleanupCount: number | null;
  progress: { current: number; total: number; label: string } | null;
  elapsedSec: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  // Particles render into this layer so they sit BEHIND glyphs and the
  // core (parent z-stack handled in JSX). A dedicated container also
  // makes cleanup trivial — we never accidentally append into the
  // glyph layer.
  const particleLayerRef = useRef<HTMLDivElement | null>(null);

  // Core pulses continuously; intensifies when syncing.
  useGSAP(
    () => {
      const core = ref.current?.querySelector("[data-core]");
      if (!core) return;
      withMotion(() => {
        gsap.to(core, {
          scale: phase === "syncing" || phase === "cleaning" ? 1.12 : 1.05,
          duration: phase === "syncing" || phase === "cleaning" ? 0.6 : 1.6,
          ease: "sine.inOut",
          yoyo: true,
          repeat: -1,
        });
      });
    },
    { dependencies: [phase, isSyncing] }
  );

  // Particle stream — append into the dedicated layer (below glyphs).
  useGSAP(
    () => {
      if (phase !== "syncing" && phase !== "cleaning") return;
      const root = ref.current;
      const layer = particleLayerRef.current;
      if (!root || !layer) return;
      const core = root.querySelector("[data-core]") as HTMLElement | null;
      const glyphs = root.querySelectorAll<HTMLElement>("[data-glyph]");
      if (!core || glyphs.length === 0) return;

      const coreRect = core.getBoundingClientRect();
      const layerRect = layer.getBoundingClientRect();
      const cx = coreRect.left + coreRect.width / 2 - layerRect.left;
      const cy = coreRect.top + coreRect.height / 2 - layerRect.top;

      const cancellers: Array<() => void> = [];
      withMotion(() => {
        glyphs.forEach((g) => {
          const gRect = g.getBoundingClientRect();
          const gx = gRect.left + gRect.width / 2 - layerRect.left;
          const gy = gRect.top + gRect.height / 2 - layerRect.top;
          const accent = g.dataset.accent ?? "hsl(var(--primary))";

          const interval = setInterval(() => {
            const dot = document.createElement("span");
            const inward = phase === "syncing";
            dot.style.position = "absolute";
            dot.style.left = `${inward ? gx : cx}px`;
            dot.style.top = `${inward ? gy : cy}px`;
            dot.style.width = "6px";
            dot.style.height = "6px";
            dot.style.borderRadius = "50%";
            dot.style.background = accent;
            dot.style.boxShadow = `0 0 10px ${accent}`;
            dot.style.pointerEvents = "none";
            dot.style.transform = "translate(-50%, -50%)";
            layer.appendChild(dot);
            gsap.to(dot, {
              x: inward ? cx - gx : gx - cx,
              y: inward ? cy - gy : gy - cy,
              scale: inward ? 0.4 : 1.4,
              opacity: 0,
              duration: 0.9,
              ease: "power2.in",
              onComplete: () => dot.remove(),
            });
          }, 350);

          cancellers.push(() => clearInterval(interval));
        });
      });

      return () => cancellers.forEach((c) => c());
    },
    { dependencies: [phase, connections.length] }
  );

  const pct =
    progress && progress.total > 0
      ? Math.round((progress.current / progress.total) * 100)
      : phase === "cleaning"
      ? 90
      : phase === "done"
      ? 100
      : 0;

  const elapsed = formatElapsed(elapsedSec);

  return (
    <div
      ref={ref}
      className="relative isolate overflow-hidden rounded-xl border border-border/40 bg-card/40 px-6 py-10"
    >
      <Aurora />

      <div className="relative mx-auto flex h-[300px] w-full max-w-md items-center justify-center">
        {/* Layer 0 — backdrop rings */}
        <div className="pointer-events-none absolute z-0 h-[280px] w-[280px] rounded-full border border-border/40" />
        <div className="pointer-events-none absolute z-0 h-[220px] w-[220px] rounded-full border border-border/30" />

        {/* Layer 1 — particles (BEHIND glyphs + core) */}
        <div
          ref={particleLayerRef}
          aria-hidden
          className="pointer-events-none absolute inset-0 z-[5]"
        />

        {/* Layer 2 — glyphs */}
        {connections.length === 0 ? (
          <div className="absolute bottom-2 left-1/2 z-10 -translate-x-1/2 text-[11px] text-muted-foreground">
            No connections — go back a step.
          </div>
        ) : (
          connections.map((c, i) => {
            const meta = PROVIDER_GLYPHS[c.provider] ?? {
              letter: c.provider[0].toUpperCase(),
              color: "hsl(var(--primary))",
            };
            const angle = (i / connections.length) * Math.PI * 2 - Math.PI / 2;
            const r = 130;
            const x = Math.cos(angle) * r;
            const y = Math.sin(angle) * r;
            return (
              <div
                key={c.id}
                data-glyph
                data-accent={meta.color}
                className="absolute z-10 flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-card/95 font-bold text-sm backdrop-blur"
                style={{
                  transform: `translate(${x}px, ${y}px)`,
                  color: meta.color,
                  boxShadow: `0 0 18px -2px ${meta.color}, inset 0 0 0 1px ${meta.color}40`,
                }}
                title={c.account_label}
              >
                {meta.letter}
              </div>
            );
          })
        )}

        {/* Layer 3 — core (above everything) */}
        <div
          data-core
          className="relative z-20 flex h-24 w-24 flex-col items-center justify-center rounded-full bg-primary text-primary-foreground"
          style={{
            boxShadow:
              phase === "syncing" || phase === "cleaning"
                ? "0 0 70px hsl(var(--primary) / 0.9), inset 0 0 0 1px hsl(var(--primary))"
                : "0 0 35px hsl(var(--primary) / 0.5)",
          }}
        >
          {phase === "done" ? (
            <>
              <span className="font-mono text-2xl tabular-nums">
                {cleanupCount ?? 0}
              </span>
              <span className="text-[8px] uppercase tracking-wider opacity-80">closed</span>
            </>
          ) : (
            <>
              <MashiMark size={32} />
              <span className="mt-0.5 text-[8px] uppercase tracking-wider opacity-80">
                {phaseLabel(phase)}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Progress bar + tickers — proves the page isn't hung */}
      {(phase === "syncing" || phase === "cleaning") && (
        <div className="relative mt-3 space-y-2">
          <div className="flex items-center justify-between text-[11px]">
            <span className="truncate font-medium text-foreground/90">
              {progress?.label ?? (phase === "cleaning" ? "Closing stale items…" : "Pulling…")}
            </span>
            <span className="font-mono text-muted-foreground tabular-nums">
              {progress ? `${progress.current}/${progress.total}` : ""}
              {progress ? " · " : ""}
              {elapsed}
            </span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{
                width: `${pct}%`,
                boxShadow: "0 0 12px hsl(var(--primary) / 0.7)",
              }}
            />
          </div>
        </div>
      )}

      {/* Status caption */}
      <div className="relative mt-2 text-center text-[12px] text-muted-foreground">
        {phase === "idle" && "Click to pull everything Mashi can see."}
        {phase === "syncing" && "Pulling history from each connected source…"}
        {phase === "cleaning" && "Closing stale items > 30 days old…"}
        {phase === "done" && (
          <span className="text-foreground/90">
            Done. <span className="text-primary">{cleanupCount}</span> stale items closed. You&apos;re ready.
          </span>
        )}
        {phase === "error" && "Hit a snag — retry above."}
      </div>
    </div>
  );
}

function formatElapsed(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem.toString().padStart(2, "0")}s`;
}

function phaseLabel(p: Phase): string {
  switch (p) {
    case "idle":
      return "ready";
    case "syncing":
      return "syncing";
    case "cleaning":
      return "cleaning";
    case "done":
      return "done";
    case "error":
      return "error";
  }
}
