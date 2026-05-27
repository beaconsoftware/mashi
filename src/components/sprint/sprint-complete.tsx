"use client";

// translucency-audit-ok: file — legacy callsites, migrate to sanctioned scale (/15, /40, /55, /60, /80, /95) case-by-case during component touch-ups.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useS2DItems, useUpdateS2DItem } from "@/hooks/use-s2d";
import { blockLiveElapsedMs, useSprintStore } from "@/store/sprint-store";
import {
  useSpawnedRail,
  type SpawnedArtifact,
  type SpawnedArtifactKind,
} from "@/store/spawned-rail-store";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/layout/primitives";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PATHWAY_META, type S2DItem } from "@/types";
import {
  Sparkles,
  Check,
  SkipForward,
  Loader2,
  AlertTriangle,
  X,
  Send,
  Scale,
  GitBranch,
  Eye,
  MessageCircle,
  CalendarPlus,
  Music,
  Undo2,
  Clock,
} from "lucide-react";
import { useGSAP } from "@gsap/react";
import { heroEntry, staggerEntry, gsap, EASE, withMotion } from "@/lib/animation";
import { cn } from "@/lib/utils";

/**
 * Sprint-complete recap (Phase 5 rewrite).
 *
 * Outcome-shaped: per-item rows that pair the user's commitment
 * (success_statement set at the contract card) with what actually
 * happened (outcome / decision / check-in / staged meeting). The
 * spawned-rail artifact chain is grouped per item so the user can see
 * the chain of moves their slot produced. Watch check-ins surface as
 * outcomes too — "Checked in on MASH-1421" — so check-in-only sprints
 * don't look empty.
 *
 * Per-skipped-item disposition controls (Keep in To Do / Backlog /
 * Snooze 24h) are preserved from the prior recap because they're load-
 * bearing for the post-sprint cleanup flow.
 */
export function SprintComplete() {
  const router = useRouter();
  const blocks = useSprintStore((s) => s.blocks);
  const sprintStartedAt = useSprintStore((s) => s.sprintStartedAt);
  const exitSprint = useSprintStore((s) => s.exitSprint);
  // Phase 7: distinguish a natural completion (every block settled) from
  // an early end (user clicked End sprint while blocks were still
  // pending). Drives the "ended early" copy + "Back to sprint" button.
  const phase = useSprintStore((s) => s.phase);
  const goBackToActive = useSprintStore((s) => s.goBackToActive);
  const artifacts = useSpawnedRail((s) => s.artifacts);
  const clearArtifacts = useSpawnedRail((s) => s.clear);
  const { data: items } = useS2DItems();
  const updateItem = useUpdateS2DItem();
  const itemMap = useMemo(
    () => new Map((items ?? []).map((i) => [i.id, i])),
    [items]
  );

  const done = blocks.filter((b) => b.status === "done").length;
  // Distinguish explicitly-skipped from never-started.
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
   * not calendar time.
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

  // Artifacts grouped by their source item so per-row chain rendering is O(1) lookup.
  const artifactsByItem = useMemo(() => {
    const map = new Map<string, typeof artifacts>();
    for (const a of artifacts) {
      const key = a.itemId ?? "__loose__";
      const existing = map.get(key) ?? [];
      existing.push(a);
      map.set(key, existing);
    }
    return map;
  }, [artifacts]);

  // Per-skipped-item disposition. Default: keep in todo.
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
  const [banner, setBanner] = useState<{ kind: "err"; msg: string } | null>(
    null
  );

  // Past-sprint aggregate — fetched lazily.
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

  // Top Spotify track during this sprint. Best-effort; absent if the
  // sprint had no music or the table is empty for this user.
  const [topTrack, setTopTrack] = useState<{
    title: string;
    artist: string;
  } | null>(null);
  useEffect(() => {
    if (!sprintStartedAt) return;
    let cancelled = false;
    const sb = createSupabaseBrowserClient();
    (async () => {
      const { data } = await sb
        .from("spotify_track_plays")
        .select("track_name, artist_name, ms_during_active")
        .gte("first_observed_at", sprintStartedAt)
        .order("ms_during_active", { ascending: false })
        .limit(1);
      if (cancelled) return;
      const row = (data ?? [])[0] as
        | { track_name: string | null; artist_name: string | null }
        | undefined;
      if (row?.track_name) {
        setTopTrack({
          title: row.track_name,
          artist: row.artist_name ?? "",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sprintStartedAt]);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const sparkleRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLOListElement | null>(null);

  useGSAP(
    () => {
      withMotion(() => {
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
      });
    },
    { scope: rootRef }
  );

  async function saveAndExit(target: "board" | "plan-another") {
    setSaving(true);
    setBanner(null);
    try {
      const work: Array<{
        id: string;
        ticket: number | null;
        promise: Promise<unknown>;
      }> = [];
      for (const b of blocks) {
        if (b.status === "done") continue;
        const disp = dispositions[b.s2dItemId];
        const it = itemMap.get(b.s2dItemId);
        const ticket = it?.ticket_number ?? null;

        if (!disp || disp === "todo") {
          // Phase 7: pending items (sprint ended early) are still in
          // `in_progress` in s2d_items because they never received a
          // Done/Skip PATCH. "Keep in To Do" should literally land them
          // in todo — otherwise the board still reads them as actively
          // worked on after the sprint exit. Skipped items were already
          // patched to todo when skipped, so this is only a no-op for
          // them.
          if (b.status !== "skipped" && it?.status === "in_progress") {
            work.push({
              id: b.s2dItemId,
              ticket,
              promise: updateItem.mutateAsync({
                id: b.s2dItemId,
                patch: { status: "todo" },
              }),
            });
          }
          continue;
        }

        if (disp === "in_progress") {
          // "Keep in Progress" — pending items already have
          // status=in_progress, so this is a no-op for them. Skipped
          // items were patched to todo when skipped; this restores the
          // in_progress status so they stay actively worked on.
          if (it?.status !== "in_progress") {
            work.push({
              id: b.s2dItemId,
              ticket,
              promise: updateItem.mutateAsync({
                id: b.s2dItemId,
                patch: { status: "in_progress" },
              }),
            });
          }
          continue;
        }

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
        .filter((w): w is {
          id: string;
          ticket: number | null;
          promise: Promise<unknown>;
        } => w != null);
      if (failed.length > 0) {
        const labels = failed
          .map((f) => (f.ticket != null ? `MASH-${f.ticket}` : f.id.slice(0, 8)))
          .join(", ");
        setBanner({
          kind: "err",
          msg: `${failed.length} disposition${failed.length === 1 ? "" : "s"} failed to save (${labels}) — those rows are still in their pre-sprint state.`,
        });
        setSaving(false);
        return;
      }

      // Persist the sprint session (focus tracking).
      try {
        const plannedItems = blocks.map((b) => {
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
          status: (b.status === "done" ? "done" : "skipped") as
            | "done"
            | "skipped",
          actual_min: actualMinById.get(b.s2dItemId) ?? 0,
        }));
        await fetch("/api/sprint/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            started_at:
              sprintStartedAt ??
              new Date(Date.now() - elapsedMin * 60_000).toISOString(),
            completed_at: new Date().toISOString(),
            planned_items: plannedItems,
            results,
          }),
        });
      } catch {
        // Local-only is fine if the session POST fails.
      }

      // Calendar event reconciliation.
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
        // Soft failure — sprint records remain the source of truth.
      }
    } finally {
      setSaving(false);
    }

    clearArtifacts();
    exitSprint();
    if (target === "board") router.push("/s2d");
    else useSprintStore.setState({ phase: "prioritize" });
  }

  return (
    <div
      ref={rootRef}
      className="flex h-full min-h-0 flex-1 justify-center overflow-hidden p-4 md:p-6"
    >
      <Surface
        // flex-col + max-h-full so the Surface fits the viewport; the
        // header + footer stay pinned and the disposition list scrolls
        // between them. Without this the surface grew past the viewport
        // and the last few rows + Save buttons got clipped on long lists.
        className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden"
        shadow="md"
      >
        <div className="shrink-0 space-y-4 p-5 text-center">
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
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setBanner(null)}
                aria-label="Dismiss"
                className="mashi-icon-glow h-5 w-5 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
          <div>
            <h1 className="text-xl font-semibold">Sprint complete</h1>
            <p className="text-sm text-muted-foreground">
              {done} done · {skipped} skipped
              {untouched > 0 ? ` · ${untouched} not done` : ""} · {elapsedMin}m
              elapsed ·{" "}
              <span title="Sum of per-block focus time. Can exceed elapsed in parallel mode (multiple slots running at once).">
                {totalActualMin}m focus
              </span>
            </p>
            {phase === "complete" && untouched > 0 && (
              <p className="mt-1 text-[12px] text-amber-300">
                Ended early with {untouched}{" "}
                {untouched === 1 ? "item" : "items"} unfinished. Pick a
                disposition for each below.
              </p>
            )}
            {phase === "complete" && untouched > 0 && (
              <div className="mt-2 flex justify-center">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={goBackToActive}
                  className="gap-1.5 text-muted-foreground"
                  title="Resume the sprint with pending items intact"
                >
                  <Undo2 className="h-3.5 w-3.5" />
                  Back to sprint
                </Button>
              </div>
            )}
          </div>

          {topTrack && (
            <div className="mx-auto inline-flex items-center gap-2 rounded-md border border-border/30 bg-secondary/30 px-3 py-1.5 text-[11px] text-muted-foreground">
              <Music className="h-3 w-3" />
              <span>Top track:</span>
              <span className="text-foreground/90">{topTrack.title}</span>
              {topTrack.artist && (
                <span className="text-muted-foreground">
                  · {topTrack.artist}
                </span>
              )}
            </div>
          )}

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
        </div>

        {/* Per-item outcome-shaped recap. */}
        <ol
          ref={listRef}
          className="min-h-0 flex-1 space-y-2 overflow-y-auto px-5 pb-3 text-left"
        >
          {blocks.map((b) => {
            const it = itemMap.get(b.s2dItemId);
            if (!it) return null;
            const chain = artifactsByItem.get(b.s2dItemId) ?? [];
            const disp = dispositions[b.s2dItemId] ?? "todo";
            return (
              <OutcomeRow
                key={b.s2dItemId}
                item={it}
                status={b.status ?? "pending"}
                successStatement={it.success_statement ?? null}
                outcome={outcomeText(it, chain)}
                chain={chain}
                actualMin={actualMinById.get(b.s2dItemId) ?? 0}
                plannedMin={b.durationMin}
                disposition={b.status === "done" ? null : disp}
                onDisposition={(v) =>
                  setDispositions((prev) => ({ ...prev, [b.s2dItemId]: v }))
                }
                saving={saving}
              />
            );
          })}
        </ol>

        <div className="shrink-0 px-5 pb-3">
          <p className="text-[10px] text-muted-foreground">
            Done items are already closed. For everything else, pick where it
            goes — defaults to staying in To Do.
          </p>
        </div>

        <div className="flex shrink-0 justify-center gap-2 border-t border-border/40 px-5 py-3">
          <Button
            variant="outline"
            size="sm"
            disabled={saving}
            onClick={() => saveAndExit("board")}
            className="gap-1.5"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
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
      </Surface>
    </div>
  );
}

type Disposition = "todo" | "in_progress" | "backlog" | "snooze";

function OutcomeRow({
  item,
  status,
  successStatement,
  outcome,
  chain,
  actualMin,
  plannedMin,
  disposition,
  onDisposition,
  saving,
}: {
  item: S2DItem;
  status: "pending" | "done" | "skipped";
  successStatement: string | null;
  outcome: string | null;
  chain: SpawnedArtifact[];
  actualMin: number;
  plannedMin: number;
  disposition: Disposition | null;
  onDisposition: (v: Disposition) => void;
  saving: boolean;
}) {
  const isDone = status === "done";
  const isPending = status === "pending";
  const meta = PATHWAY_META[item.pathway];
  const over = actualMin > plannedMin;
  const under = actualMin > 0 && actualMin < plannedMin;
  return (
    <li
      className={cn(
        "rounded-md border bg-card p-3",
        isDone && "border-emerald-500/30 bg-emerald-500/15",
        // Phase 7: pending rows = "left unfinished when sprint ended".
        // Sanctioned /15 + /40 (per AGENTS.md design-token doctrine).
        isPending && "border-amber-500/40 bg-amber-500/15",
        !isDone && !isPending && "border-border/40"
      )}
    >
      <div className="flex items-start gap-2">
        <span
          className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded text-[14px]"
          style={{
            color: `hsl(var(${meta.colorVar}))`,
            backgroundColor: `hsl(var(${meta.colorVar}) / 0.15)`,
          }}
          title={meta.label}
        >
          {meta.icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="font-mono">MASH-{item.ticket_number}</span>
            <span className="line-clamp-1 text-foreground/90">
              {item.title}
            </span>
            <span className="ml-auto inline-flex items-center gap-1 font-mono">
              <span
                className={cn(
                  over && "text-amber-300",
                  under && "text-emerald-300"
                )}
              >
                {actualMin}m
              </span>
              <span className="opacity-50">/{plannedMin}m</span>
            </span>
          </div>

          {successStatement && (
            <div className="mt-2 text-[12px] text-foreground/85">
              <span className="text-muted-foreground">Committed: </span>
              {successStatement}
            </div>
          )}

          <div className="mt-1 flex items-start gap-1.5 text-[12px]">
            {isDone ? (
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
            ) : isPending ? (
              <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
            ) : (
              <SkipForward className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className="text-foreground/85">
              {outcome ??
                (isDone
                  ? "Marked done"
                  : isPending
                    ? "Not finished — left unsettled when sprint ended"
                    : "Not finished")}
            </span>
          </div>

          {chain.length > 0 && (
            <ul className="mt-2 space-y-1 border-l border-border/40 pl-2 text-[11px] text-muted-foreground">
              {chain.map((a) => (
                <li key={a.id} className="flex items-start gap-1.5">
                  <ChainIcon kind={a.kind} />
                  <span className="text-foreground/80">{a.label}</span>
                  <span className="line-clamp-1 flex-1 italic">{a.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {!isDone && disposition && (
          <Select
            value={disposition}
            onValueChange={(v) => onDisposition(v as Disposition)}
            disabled={saving}
          >
            <SelectTrigger className="h-7 shrink-0 rounded border-border/40 bg-secondary px-2 py-0.5 text-[11px] font-medium">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todo">Keep in To Do</SelectItem>
              <SelectItem value="in_progress">Keep in Progress</SelectItem>
              <SelectItem value="backlog">Move to Backlog</SelectItem>
              <SelectItem value="snooze">Snooze 24h</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>
    </li>
  );
}

function outcomeText(
  item: S2DItem,
  chain: SpawnedArtifact[]
): string | null {
  if (item.outcome) return item.outcome;
  // Synthesize a check-in flavored outcome when the item resolved via
  // "Still watching" in WatchCanvas — the slot completed without an
  // explicit outcome string, but the spawned artifact records the
  // check-in. Spec calls this out explicitly so check-in-only sprints
  // don't read as empty.
  const checkIn = chain.find((a) => a.kind === "check-in");
  if (checkIn) {
    return `Checked in — ${checkIn.detail || "still watching"}`;
  }
  const sent = chain.find((a) => a.kind === "sent");
  if (sent) return `Sent — ${sent.detail || sent.label}`;
  const decision = chain.find((a) => a.kind === "decision");
  if (decision) return `${decision.label}: ${decision.detail}`;
  const staged = chain.find((a) => a.kind === "staged-meeting");
  if (staged) return `Staged for meeting — ${staged.detail}`;
  return null;
}

function ChainIcon({ kind }: { kind: SpawnedArtifactKind }) {
  const cls = "mt-0.5 h-3 w-3 shrink-0";
  switch (kind) {
    case "sent":
      return <Send className={cls} />;
    case "decision":
      return <Scale className={cls} />;
    case "follow-up":
      return <GitBranch className={cls} />;
    case "check-in":
      return <Eye className={cls} />;
    case "nudge":
      return <MessageCircle className={cls} />;
    case "staged-meeting":
      return <CalendarPlus className={cls} />;
  }
}
