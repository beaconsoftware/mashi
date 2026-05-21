"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useS2DItems, useUpdateS2DItem } from "@/hooks/use-s2d";
import { blockLiveElapsedMs, useSprintStore } from "@/store/sprint-store";
import { Button } from "@/components/ui/button";
import {
  Sparkles,
  Check,
  SkipForward,
  Loader2,
  AlertTriangle,
  X,
} from "lucide-react";
import { useGSAP } from "@gsap/react";
import { heroEntry, staggerEntry, gsap, EASE } from "@/lib/animation";
import { cn } from "@/lib/utils";

/**
 * Shown when activeIndex passes the end of blocks[]. Two-part screen:
 *
 * 1. Recap stats — done / skipped / elapsed
 * 2. Per-item checkout — for every item that was skipped (or never
 *    started), the user picks where it goes next:
 *      - To Do  (default — pick it up tomorrow)
 *      - Backlog (not this week)
 *      - Snooze 24h (in_queue until tomorrow 9am)
 *
 *    Done items don't get a control — they're already marked done by
 *    sprint-active-mode.markDone(). Read-only line just confirms it.
 *
 * Save & exit applies the per-item dispositions in parallel, then
 * exits the sprint.
 */
export function SprintComplete() {
  const router = useRouter();
  const blocks = useSprintStore((s) => s.blocks);
  const sprintStartedAt = useSprintStore((s) => s.sprintStartedAt);
  const exitSprint = useSprintStore((s) => s.exitSprint);
  const { data: items } = useS2DItems();
  const updateItem = useUpdateS2DItem();
  const itemMap = useMemo(
    () => new Map((items ?? []).map((i) => [i.id, i])),
    [items]
  );

  const done = blocks.filter((b) => b.status === "done").length;
  // Distinguish explicitly-skipped from never-started so the recap doesn't
  // claim Sidd skipped work he never had a chance to start (e.g. exited
  // the sprint manually with items still pending).
  const skipped = blocks.filter((b) => b.status === "skipped").length;
  const untouched = blocks.filter(
    (b) => b.status !== "done" && b.status !== "skipped"
  ).length;
  const totalMin = blocks.reduce((s, b) => s + b.durationMin, 0);
  const elapsedMin = sprintStartedAt
    ? Math.round((Date.now() - new Date(sprintStartedAt).getTime()) / 60_000)
    : totalMin;

  /**
   * Actual focused minutes per block, from accumulated active-slot time.
   * In parallel mode each slot keeps its own timer, so totals can exceed
   * wall-clock elapsedMin — that's correct: it reflects attention spent,
   * not calendar time. Skipped blocks still report whatever time they
   * accumulated in a slot before being moved out.
   *
   * Memoized on sprintStartedAt so the snapshot stays stable across
   * renders (Date.now() inside would re-tick every render).
   */
  const actualMinById = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of blocks) {
      const ms = blockLiveElapsedMs(b, false);
      map.set(b.s2dItemId, Math.max(0, Math.round(ms / 60_000)));
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks, sprintStartedAt]);
  const totalActualMin = useMemo(
    () => Array.from(actualMinById.values()).reduce((s, v) => s + v, 0),
    [actualMinById]
  );

  // Per-skipped-item disposition. Default: keep in todo.
  type Disposition = "todo" | "backlog" | "snooze";
  const [dispositions, setDispositions] = useState<Record<string, Disposition>>(
    () => {
      const map: Record<string, Disposition> = {};
      for (const b of blocks) {
        if (b.status !== "done") map[b.s2dItemId] = "todo";
      }
      return map;
    }
  );
  const [saving, setSaving] = useState(false);
  // Inline banner — surfaces disposition save failures so the user knows
  // which rows are still stuck at their pre-sprint state rather than
  // confidently navigating away on "Save & back to board".
  const [banner, setBanner] = useState<{ kind: "err"; msg: string } | null>(null);

  // Past-sprint aggregate — fetched lazily so the recap renders fast.
  // null while loading, undefined if endpoint isn't available, else the
  // computed aggregate over recent sessions.
  const [aggregate, setAggregate] = useState<{
    total_sessions: number;
    total_done: number;
    total_planned: number;
    completion_rate: number | null;
    total_focus_min: number;
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/sprint/session?limit=10")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled && j?.aggregate) setAggregate(j.aggregate);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const sparkleRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLOListElement | null>(null);

  useGSAP(
    () => {
      if (rootRef.current) heroEntry(rootRef.current);
      if (sparkleRef.current) {
        gsap.fromTo(
          sparkleRef.current,
          { rotate: -90, scale: 0 },
          { rotate: 0, scale: 1, duration: 0.6, ease: EASE.elastic, delay: 0.15 }
        );
      }
      if (listRef.current) {
        staggerEntry(listRef.current.children, { delay: 0.3, stagger: 0.06 });
      }
    },
    { scope: rootRef }
  );

  async function saveAndExit(target: "board" | "plan-another") {
    setSaving(true);
    setBanner(null);
    try {
      // Apply each skipped item's chosen disposition. Done items already
      // have status='done' from active-mode's markDone — skip them here.
      // We track the item id per work entry so a Promise.allSettled
      // rejection can be reported by ticket rather than silently dropped.
      const work: Array<{ id: string; ticket: number | null; promise: Promise<unknown> }> = [];
      for (const b of blocks) {
        if (b.status === "done") continue;
        const disp = dispositions[b.s2dItemId];
        if (!disp || disp === "todo") continue; // already at "todo" from advance(skipped)
        const it = itemMap.get(b.s2dItemId);
        const ticket = it?.ticket_number ?? null;

        if (disp === "backlog") {
          work.push({
            id: b.s2dItemId,
            ticket,
            promise: updateItem.mutateAsync({
              id: b.s2dItemId,
              patch: { status: "backlog" },
            }),
          });
        } else if (disp === "snooze") {
          const t = new Date();
          t.setDate(t.getDate() + 1);
          t.setHours(9, 0, 0, 0);
          work.push({
            id: b.s2dItemId,
            ticket,
            promise: updateItem.mutateAsync({
              id: b.s2dItemId,
              patch: {
                status: "in_queue",
                snoozed_until: t.toISOString(),
                queue_reason: "Snoozed at sprint complete (24h)",
              },
            }),
          });
        }
      }
      const results = await Promise.allSettled(work.map((w) => w.promise));
      const failed = results
        .map((r, i) => (r.status === "rejected" ? work[i] : null))
        .filter((w): w is { id: string; ticket: number | null; promise: Promise<unknown> } => w != null);
      if (failed.length > 0) {
        const labels = failed
          .map((f) => (f.ticket != null ? `MASH-${f.ticket}` : f.id.slice(0, 8)))
          .join(", ");
        setBanner({
          kind: "err",
          msg: `${failed.length} disposition${failed.length === 1 ? "" : "s"} failed to save (${labels}) — those rows are still in their pre-sprint state.`,
        });
        setSaving(false);
        return; // don't navigate away — user needs to see which rows are stuck
      }

      // Persist the sprint to sprint_sessions for performance tracking.
      // Fire-and-forget — failure doesn't block the exit flow, since the
      // session record is for after-the-fact analysis only.
      try {
        const plannedItems = blocks
          .map((b) => {
            const it = itemMap.get(b.s2dItemId);
            return {
              s2d_item_id: b.s2dItemId,
              title: it?.title ?? null,
              pathway: it?.pathway ?? null,
              priority: it?.priority ?? null,
              est_minutes: b.durationMin,
            };
          });
        const results = blocks.map((b) => ({
          s2d_item_id: b.s2dItemId,
          status: (b.status === "done" ? "done" : "skipped") as "done" | "skipped",
          actual_min: actualMinById.get(b.s2dItemId) ?? 0,
        }));
        await fetch("/api/sprint/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            started_at: sprintStartedAt ?? new Date(Date.now() - elapsedMin * 60_000).toISOString(),
            completed_at: new Date().toISOString(),
            planned_items: plannedItems,
            results,
          }),
        });
      } catch {
        // Ignore — local-only is fine if the session POST fails.
      }

      // Update each block's calendar event to reflect actual time spent.
      // PATCH-shrink done blocks, DELETE skipped ones. Fire-and-forget —
      // calendar drift is a soft failure (the s2d_items + sprint_sessions
      // record is the source of truth), but we want it best-effort.
      try {
        await fetch("/api/sprint/finalize-events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            blocks: blocks.map((b) => ({
              s2dItemId: b.s2dItemId,
              status: (b.status === "done" ? "done" : "skipped") as
                | "done"
                | "skipped",
              actualMin: actualMinById.get(b.s2dItemId) ?? 0,
            })),
          }),
        });
      } catch {
        // Ignore — calendar update failure shouldn't block sprint exit.
      }
    } finally {
      setSaving(false);
    }

    exitSprint();
    if (target === "board") router.push("/s2d");
    else useSprintStore.setState({ phase: "prioritize" });
  }

  return (
    <div ref={rootRef} className="flex h-full flex-1 items-center justify-center p-6">
      <div className="w-full max-w-xl space-y-4 text-center">
        <div
          ref={sparkleRef}
          className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/15"
        >
          <Sparkles className="h-5 w-5 text-primary" />
        </div>
        {banner && (
          <div className="flex items-start gap-2 rounded border border-destructive/40 bg-destructive/10 p-2.5 text-left text-[12px] text-destructive">
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
        <h1 className="text-xl font-semibold">Sprint complete</h1>
        <p className="text-sm text-muted-foreground">
          {done} done · {skipped} skipped
          {untouched > 0 ? ` · ${untouched} untouched` : ""} · {elapsedMin}m
          elapsed ·{" "}
          <span title="Sum of per-block focus time. Can exceed elapsed in parallel mode (multiple slots running at once).">
            {totalActualMin}m focus
          </span>
        </p>

        {aggregate && aggregate.total_sessions > 0 && (
          <div className="mx-auto inline-flex items-center gap-3 rounded-md border border-border/30 bg-secondary/30 px-3 py-1.5 text-[11px] text-muted-foreground">
            <span>
              Last {aggregate.total_sessions} sprint
              {aggregate.total_sessions === 1 ? "" : "s"}:
            </span>
            {aggregate.completion_rate != null && (
              <span className="font-mono text-foreground/85">
                {Math.round(aggregate.completion_rate * 100)}% completion
              </span>
            )}
            <span>·</span>
            <span className="font-mono text-foreground/85">
              {Math.round(aggregate.total_focus_min / 60)}h focus
            </span>
          </div>
        )}

        {/* Per-item recap with disposition controls for skipped items. */}
        <ol ref={listRef} className="space-y-1.5 text-left">
          {blocks.map((b) => {
            const it = itemMap.get(b.s2dItemId);
            if (!it) return null;
            const isDone = b.status === "done";
            return (
              <li
                key={b.s2dItemId}
                className={cn(
                  "flex items-center gap-2 rounded border border-border/40 bg-card p-2 text-[12px]",
                  isDone && "border-emerald-500/30 bg-emerald-500/5"
                )}
              >
                {isDone ? (
                  <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                ) : (
                  <SkipForward className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className="w-14 font-mono text-[10px] text-muted-foreground">
                  MASH-{it.ticket_number}
                </span>
                <span className="line-clamp-1 flex-1">{it.title}</span>
                {(() => {
                  const actual = actualMinById.get(b.s2dItemId) ?? 0;
                  const planned = b.durationMin;
                  const over = actual > planned;
                  const under = actual > 0 && actual < planned;
                  return (
                    <span
                      className="w-16 text-right font-mono text-[10px] text-muted-foreground"
                      title={`Actual ${actual}m of planned ${planned}m`}
                    >
                      <span
                        className={cn(
                          over && "text-amber-300",
                          under && "text-emerald-300"
                        )}
                      >
                        {actual}m
                      </span>
                      <span className="opacity-50">/{planned}m</span>
                    </span>
                  );
                })()}
                {isDone ? (
                  <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
                    done
                  </span>
                ) : (
                  <select
                    value={dispositions[b.s2dItemId] ?? "todo"}
                    onChange={(e) =>
                      setDispositions((prev) => ({
                        ...prev,
                        [b.s2dItemId]: e.target.value as Disposition,
                      }))
                    }
                    className="rounded border border-border/40 bg-secondary px-1.5 py-0.5 text-[10px] font-medium"
                    disabled={saving}
                  >
                    <option value="todo">Keep in To Do</option>
                    <option value="backlog">Move to Backlog</option>
                    <option value="snooze">Snooze 24h</option>
                  </select>
                )}
              </li>
            );
          })}
        </ol>

        <p className="text-[10px] text-muted-foreground">
          Done items are already closed. For everything else, pick where it goes —
          defaults to staying in To Do. Calendar events for done blocks resize to
          your actual focus time; skipped blocks are removed.
        </p>

        <div className="flex justify-center gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            disabled={saving}
            onClick={() => saveAndExit("board")}
            className="gap-1.5"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : null}
            Save & back to board
          </Button>
          <Button
            size="sm"
            disabled={saving}
            onClick={() => saveAndExit("plan-another")}
            className="gap-1.5"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Save & plan another
          </Button>
        </div>
      </div>
    </div>
  );
}
