"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useS2DItems, useUpdateS2DItem } from "@/hooks/use-s2d";
import { useSprintStore } from "@/store/sprint-store";
import { Button } from "@/components/ui/button";
import {
  Sparkles,
  Check,
  SkipForward,
  Loader2,
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
  const skipped = blocks.filter((b) => b.status !== "done").length;
  const totalMin = blocks.reduce((s, b) => s + b.durationMin, 0);
  const elapsedMin = sprintStartedAt
    ? Math.round((Date.now() - new Date(sprintStartedAt).getTime()) / 60_000)
    : totalMin;

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
    try {
      // Apply each skipped item's chosen disposition. Done items already
      // have status='done' from active-mode's markDone — skip them here.
      const work: Promise<unknown>[] = [];
      for (const b of blocks) {
        if (b.status === "done") continue;
        const disp = dispositions[b.s2dItemId];
        if (!disp || disp === "todo") continue; // already at "todo" from advance(skipped)

        if (disp === "backlog") {
          work.push(
            updateItem.mutateAsync({
              id: b.s2dItemId,
              patch: { status: "backlog" },
            })
          );
        } else if (disp === "snooze") {
          const t = new Date();
          t.setDate(t.getDate() + 1);
          t.setHours(9, 0, 0, 0);
          work.push(
            updateItem.mutateAsync({
              id: b.s2dItemId,
              patch: {
                status: "in_queue",
                snoozed_until: t.toISOString(),
                queue_reason: "Snoozed at sprint complete (24h)",
              },
            })
          );
        }
      }
      await Promise.allSettled(work);
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
        <h1 className="text-xl font-semibold">Sprint complete</h1>
        <p className="text-sm text-muted-foreground">
          {done} done · {skipped} skipped · {elapsedMin}m elapsed
        </p>

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
                <span className="w-10 text-right font-mono text-[10px] text-muted-foreground">
                  {b.durationMin}m
                </span>
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
          defaults to staying in To Do.
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
