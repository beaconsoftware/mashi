"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface UndoableAction {
  token: string;
  summary: string;
  /** Absent for a non-recallable note (E4). */
  expiresAt?: string;
  toolName: string;
  /** E4: false for an irreversible ring-3 send. The strip renders a neutral
   * "can't be recalled" note rather than an Undo control. Defaults to true. */
  recallable?: boolean;
}

interface Props {
  action: UndoableAction;
  /** Called after a successful undo so the parent can drop the strip
   * and refresh whichever query reflects the now-reverted state. */
  onUndone?: () => void;
  /** Called when the 30s window elapses with no click. */
  onExpired?: () => void;
}

/**
 * Pinned under the thread message list while a ring-2 action sits
 * within its 30s undo window. The countdown is purely cosmetic, the
 * server enforces the same expiry on POST /api/agent/undo.
 *
 * Doctrine notes:
 *   - shadcn Button (no hand-rolls).
 *   - Sanctioned translucency steps: bg-card/80 + amber-500/15.
 *   - Motion ride-along: CSS `transition` on the linear progress
 *     bar (no GSAP); reduced-motion users see the bar jump rather
 *     than smoothly drain, which is fine.
 */
export function UndoStrip({ action, onUndone, onExpired }: Props) {
  // E4: an irreversible ring-3 send has no recall — render a neutral note,
  // honestly, instead of a dead Undo button.
  const recallable = action.recallable !== false && !!action.expiresAt;
  const expiresAt = new Date(action.expiresAt ?? 0).getTime();
  const totalMs = Math.max(expiresAt - Date.now(), 1);
  const [remainingMs, setRemainingMs] = useState(() =>
    Math.max(expiresAt - Date.now(), 0)
  );
  const [undoing, setUndoing] = useState(false);
  const [resolved, setResolved] = useState<"undone" | "expired" | "error" | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (resolved || !recallable) return;
    const tick = () => {
      const ms = Math.max(expiresAt - Date.now(), 0);
      setRemainingMs(ms);
      if (ms === 0) {
        setResolved("expired");
        onExpired?.();
      }
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [expiresAt, onExpired, resolved, recallable]);

  async function clickUndo() {
    if (undoing || resolved) return;
    setUndoing(true);
    setError(null);
    try {
      const res = await fetch("/api/agent/undo", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: action.token }),
      });
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
      } | null;
      if (!res.ok || !body?.ok) {
        setError(body?.error ?? "Couldn't undo.");
        setResolved("error");
        return;
      }
      setResolved("undone");
      onUndone?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't undo.");
      setResolved("error");
    } finally {
      setUndoing(false);
    }
  }

  const seconds = Math.ceil(remainingMs / 1000);
  const pct = Math.max(0, Math.min(100, (remainingMs / totalMs) * 100));

  // E4: non-recallable ring-3 send — a neutral, honest note, no controls.
  if (!recallable) {
    return (
      <div className="rounded-md border border-border/40 bg-card/80 px-2.5 py-1.5 text-[11px] text-muted-foreground">
        {action.summary}
      </div>
    );
  }

  if (resolved === "undone") {
    return (
      <div className="mashi-magnetic flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1.5 text-xs">
        <Check className="h-3 w-3 text-emerald-400" />
        <span className="text-foreground/85">Undone</span>
      </div>
    );
  }

  if (resolved === "expired" || resolved === "error") {
    return (
      <div className="rounded-md border border-border/40 bg-card/80 px-2.5 py-1.5 text-[11px] text-muted-foreground">
        <span>{action.summary}</span>
        <span className="ml-1.5 text-muted-foreground/70">
          {error ??
            "This action can no longer be undone, too much time has passed."}
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-md border border-amber-500/40 bg-amber-500/15 px-2.5 py-1.5"
      )}
    >
      <div className="flex items-center gap-2 text-xs">
        <Check className="h-3 w-3 shrink-0 text-amber-400" />
        <span className="flex-1 truncate text-foreground/85">
          {action.summary}
        </span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={clickUndo}
          disabled={undoing}
          // L2: the thread's quick-undo (⌘/Ctrl+Z) and arrow roving find this
          // control by attribute and click it, reusing the undo path as-is.
          data-thread-action="undo"
          className="mashi-press h-6 gap-1 px-2 text-[11px]"
        >
          {undoing ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RotateCcw className="h-3 w-3" />
          )}
          Undo
        </Button>
        <span className="font-mono text-[10px] tabular-nums text-muted-foreground/80">
          {seconds}s
        </span>
      </div>
      {/* K3: the recall countdown bar animates via transform: scaleX (GPU-
          composited) rather than width, so it never triggers per-frame layout.
          The track is full-width; the fill scales from the left edge. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-amber-500/40">
        <div
          className="h-full w-full origin-left bg-amber-500/95 transition-transform duration-200 ease-linear motion-reduce:transition-none"
          style={{ transform: `scaleX(${Math.max(0, Math.min(pct, 100)) / 100})` }}
        />
      </div>
    </div>
  );
}
