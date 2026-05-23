"use client";

import { useEffect, useMemo, useState } from "react";
import { useS2DItems } from "@/hooks/use-s2d";
import { useSprintStore, MAX_PARALLEL_SLOTS } from "@/store/sprint-store";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Play, CalendarCheck, Loader2, AlertTriangle } from "lucide-react";
import { PathwayBadge } from "@/components/shared/pathway-badge";
import { PriorityDot } from "@/components/shared/priority-dot";
import { PlannerHeader } from "./planner-prioritize";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

interface CalAccount {
  id: string;
  account_email: string | null;
  account_label: string;
}

/**
 * Stage 3: review + lock-in.
 *
 * Lock-in writes:
 *   1. sprint_start_at / sprint_end_at on each S2D item (always)
 *   2. (optional) GCal events via /api/sprint/create-events
 *
 * Event title is just `MASH-{ticket}` so peers don't see your work titles
 * on their shared-calendar view; the description has the full title +
 * pathway + a deep link back to the Mashi item.
 */
export function PlannerReview() {
  const { data: items } = useS2DItems();
  const blocks = useSprintStore((s) => s.blocks);
  const createCal = useSprintStore((s) => s.createCalendarEvents);
  const setCreateCal = useSprintStore((s) => s.setCreateCalendarEvents);
  const calAccountId = useSprintStore((s) => s.calendarAccountId);
  const setCalAccountId = useSprintStore((s) => s.setCalendarAccountId);
  const setPhase = useSprintStore((s) => s.setPhase);
  const start = useSprintStore((s) => s.startSprint);
  const updateBlock = useSprintStore((s) => s.updateBlock);
  const exit = useSprintStore((s) => s.exitSprint);

  const [accounts, setAccounts] = useState<CalAccount[]>([]);
  const [locking, setLocking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // True when we auto-picked the first calendar account because the user
  // had multiple connected but hadn't chosen one yet. Surfaces a small
  // "Change…" hint so the silent pick doesn't surprise anyone.
  const [autoPicked, setAutoPicked] = useState(false);

  const itemMap = useMemo(
    () => new Map((items ?? []).map((i) => [i.id, i])),
    [items]
  );

  // Load calendar-capable connections
  useEffect(() => {
    const sb = createSupabaseBrowserClient();
    sb.from("connected_accounts")
      .select("id, account_email, account_label, provider")
      .in("provider", ["gcal", "mscal"])
      .then(({ data }) => {
        const rows = (data ?? []) as Array<CalAccount & { provider: string }>;
        setAccounts(rows);
        if (rows.length > 0 && !calAccountId) {
          setCalAccountId(rows[0].id);
          // Only flag as auto-picked when there's >1 choice; with a single
          // account the pick is forced and surfacing a hint would be noise.
          if (rows.length > 1) setAutoPicked(true);
        }
      });
  }, [calAccountId, setCalAccountId]);

  async function lockIn() {
    setLocking(true);
    setErr(null);
    try {
      const res = await fetch("/api/sprint/create-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blocks,
          createCalendarEvents: createCal,
          calendarAccountId: calAccountId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error ?? "Lock-in failed");
        return;
      }
      // Stamp event ids back on our blocks
      if (Array.isArray(data.events)) {
        for (const ev of data.events as Array<{
          s2dItemId: string;
          calendarEventId: string | null;
        }>) {
          updateBlock(ev.s2dItemId, { calendarEventId: ev.calendarEventId });
        }
      }
      start();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Lock-in failed");
    } finally {
      setLocking(false);
    }
  }

  return (
    <div className="flex h-full flex-col bg-card">
      <PlannerHeader phase="review" onCancel={exit} />

      <div className="flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-2xl space-y-3">
          <div className="rounded-md border border-border/40 bg-card p-4">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Calendar
            </div>
            <label className="mt-2 flex items-start gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={createCal}
                onChange={(e) => setCreateCal(e.target.checked)}
                className="mt-0.5 accent-primary"
              />
              <span>
                Push these blocks to my calendar.{" "}
                <span className="text-muted-foreground">
                  Event title is just <span className="font-mono">MASH-N</span> so
                  peers don't see the work titles on shared views; the full title +
                  pathway + Mashi link goes in the description.
                </span>
              </span>
            </label>
            {createCal && accounts.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px]">
                <span className="text-muted-foreground">Push to</span>
                <select
                  value={calAccountId ?? ""}
                  onChange={(e) => {
                    setCalAccountId(e.target.value || null);
                    setAutoPicked(false);
                  }}
                  className="rounded border border-border/40 bg-secondary px-2 py-1 text-[12px]"
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.account_label} {a.account_email ? `(${a.account_email})` : ""}
                    </option>
                  ))}
                </select>
                {autoPicked && (
                  <span className="text-[11px] text-amber-500/90">
                    Auto-picked. Switch above if this is the wrong calendar.
                  </span>
                )}
              </div>
            )}
            {createCal && accounts.length === 0 && (
              <div className="mt-2 flex items-start gap-2 rounded border border-amber-500/30 bg-amber-500/10 p-2 text-[12px] text-amber-100">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  No calendar connected. Connect Google Calendar in Settings →
                  Connections to push blocks, or untick the box to start without
                  calendar events.
                </span>
              </div>
            )}
          </div>

          <ol className="space-y-1.5">
            {blocks.map((b, i) => {
              const it = itemMap.get(b.s2dItemId);
              if (!it) return null;
              // Parallel mode: first MAX_PARALLEL_SLOTS items run
              // concurrently when the sprint starts; rest auto-promote
              // on Done/Skip. No sequential clock times.
              const inSlot = i < MAX_PARALLEL_SLOTS;
              return (
                <li
                  key={b.s2dItemId}
                  className="flex items-center gap-3 rounded-md border border-border/40 bg-card p-3"
                >
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 font-mono text-[10px]",
                      inSlot
                        ? "bg-primary/15 font-bold text-primary"
                        : "bg-secondary/60 text-muted-foreground"
                    )}
                  >
                    {inSlot ? `slot ${i + 1}` : `queue ${i - MAX_PARALLEL_SLOTS + 1}`}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[10px] text-muted-foreground">
                        MASH-{it.ticket_number}
                      </span>
                      <PriorityDot priority={it.priority} />
                      <PathwayBadge pathway={it.pathway} />
                    </div>
                    <div className="line-clamp-1 text-[13px] text-foreground/90">
                      {it.title}
                    </div>
                  </div>
                  <div className="text-right font-mono text-[11px] text-muted-foreground">
                    {b.durationMin}m budget
                  </div>
                </li>
              );
            })}
          </ol>

          {err && (
            <div className="flex items-start gap-2 rounded border border-destructive/30 bg-destructive/10 p-2 text-[12px] text-destructive">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{err}</span>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-border/40 px-4 py-3">
        <Button variant="ghost" size="sm" onClick={() => setPhase("schedule")} className="gap-1.5">
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={exit} disabled={locking}>
            Cancel
          </Button>
          <Button size="sm" onClick={lockIn} disabled={locking || blocks.length === 0} className="gap-1.5">
            {locking ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : createCal ? (
              <CalendarCheck className="h-3.5 w-3.5" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            {locking ? "Locking in…" : "Start sprint"}
          </Button>
        </div>
      </div>
    </div>
  );
}

