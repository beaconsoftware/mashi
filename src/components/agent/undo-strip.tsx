"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { UNDO_WINDOW_MS } from "@/lib/agent/undo";

/**
 * Pinned-to-bottom undo affordance shown inside ThreadView when a
 * ring-2 (write_mashi) tool call lands. The loop emits an `undoable`
 * SSE delta carrying `{ action_id, summary, expires_at }`; ThreadView
 * stacks these into a list and renders one strip per pending action.
 *
 * The strip auto-fades when `expires_at` passes (clamped to 30s so we
 * never display a hostile-looking timer). Clicking Undo POSTs to
 * /api/agent/undo and on success removes the strip + invalidates
 * relevant TanStack Query caches so the board snaps back to its prior
 * state.
 *
 * Doctrine: shadcn Button; sanctioned translucency `/15` on
 * background, `/40` on border (AGENTS.md design tokens).
 */
export interface PendingUndoable {
  /** Tool-call id from the agent loop. Used as React key + dedupe. */
  id: string;
  action_id: string;
  summary: string;
  expires_at: string | null;
}

interface UndoStripProps {
  pending: PendingUndoable[];
  onResolved: (id: string) => void;
}

export function UndoStrip({ pending, onResolved }: UndoStripProps) {
  if (pending.length === 0) return null;
  return (
    <div className="pointer-events-none sticky bottom-0 z-10 flex flex-col gap-1.5 pb-1">
      {pending.map((p) => (
        <UndoRow key={p.id} entry={p} onResolved={onResolved} />
      ))}
    </div>
  );
}

function UndoRow({
  entry,
  onResolved,
}: {
  entry: PendingUndoable;
  onResolved: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(() =>
    computeSecondsLeft(entry.expires_at)
  );
  const expiredRef = useRef(false);

  useEffect(() => {
    if (secondsLeft <= 0 && !expiredRef.current) {
      expiredRef.current = true;
      // Soft-fade: small delay so the user sees the 0 tick.
      const t = setTimeout(() => onResolved(entry.id), 250);
      return () => clearTimeout(t);
    }
    if (secondsLeft <= 0) return;
    const t = setInterval(() => {
      setSecondsLeft(computeSecondsLeft(entry.expires_at));
    }, 500);
    return () => clearInterval(t);
  }, [secondsLeft, entry.expires_at, entry.id, onResolved]);

  async function undo() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/agent/undo", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action_id: entry.action_id }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          reason?: string;
        };
        setError(body.error ?? `Undo failed (${res.status}).`);
        setBusy(false);
        return;
      }
      // Invalidate any board / sprint caches so the UI rolls back.
      // Canonical keys live in src/hooks/use-s2d.ts.
      queryClient.invalidateQueries({ queryKey: ["s2d_items"] });
      queryClient.invalidateQueries({ queryKey: ["s2d_context"] });
      queryClient.invalidateQueries({ queryKey: ["sprint"] });
      queryClient.invalidateQueries({ queryKey: ["agent-thread"] });
      onResolved(entry.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Undo failed.");
      setBusy(false);
    }
  }

  return (
    <div className="pointer-events-auto rounded-md border border-primary/40 bg-primary/15 px-3 py-1.5 text-[12px] backdrop-blur-sm">
      <div className="flex items-center gap-2">
        <span className="text-emerald-400">✓</span>
        <span className="flex-1 text-foreground/90">{entry.summary}</span>
        {!error && secondsLeft > 0 && (
          <span className="font-mono text-[10px] text-muted-foreground">
            {secondsLeft}s
          </span>
        )}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy || secondsLeft <= 0}
          onClick={undo}
          className="mashi-press h-6 gap-1 px-2 text-[11px]"
        >
          {busy ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RotateCcw className="h-3 w-3" />
          )}
          Undo
        </Button>
      </div>
      {error && (
        <p className="mt-1 text-[11px] text-destructive">{error}</p>
      )}
    </div>
  );
}

function computeSecondsLeft(expiresAt: string | null): number {
  if (!expiresAt) return Math.ceil(UNDO_WINDOW_MS / 1000);
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (Number.isNaN(ms)) return 0;
  return Math.max(0, Math.ceil(ms / 1000));
}

/**
 * Convenience hook for ThreadView: keeps a `pending` queue of undoables
 * keyed by tool-call id. Accepts an incoming delta and an external
 * "this id resolved" signal.
 */
export function useUndoStripQueue(): {
  pending: PendingUndoable[];
  push: (entry: PendingUndoable) => void;
  remove: (id: string) => void;
  clear: () => void;
} {
  const [pending, setPending] = useState<PendingUndoable[]>([]);
  const apis = useMemo(
    () => ({
      push: (entry: PendingUndoable) =>
        setPending((prev) => {
          if (prev.some((p) => p.id === entry.id)) return prev;
          return [...prev, entry];
        }),
      remove: (id: string) =>
        setPending((prev) => prev.filter((p) => p.id !== id)),
      clear: () => setPending([]),
    }),
    []
  );
  return { pending, ...apis };
}
