"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Check,
  Loader2,
  Eye,
  EyeOff,
  ArrowUpRight,
  Inbox,
  MessageSquare,
  Calendar,
  GitBranch,
  KanbanSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { CanvasShell, type CanvasBaseProps } from "./_shared/canvas-shell";
import { useUpdateS2DItem } from "@/hooks/use-s2d";
import {
  useRecordCheckIn,
  useWatchCheckIns,
  type ActivitySignal,
} from "@/hooks/use-watch-check-ins";
import { useSpawnedRail } from "@/store/spawned-rail-store";
import type { EnrichSourceKind } from "@/hooks/use-enriched-context";
import type { Pathway } from "@/types";

/**
 * WatchCanvas — serves `watching` items.
 *
 * The pathway means: action already taken, waiting for a response or
 * external event. This canvas surfaces "what's happened since you last
 * checked" and offers four exits:
 *
 *   • Still watching   → log check-in, item stays in_queue, slot promotes
 *   • Resolved         → close terminally with an outcome
 *   • Stop watching    → close terminally with resolved_via='abandoned'
 *   • Promote to action → re-pathway to quick_reply or decision_gate
 *
 * The "watching for" line is the user's editable summary of what
 * outcome they're waiting on. It writes to the item's description so
 * it's visible everywhere the item shows up.
 */

type PromoteTarget = Extract<Pathway, "quick_reply" | "decision_gate">;

const SOURCE_ICON: Record<EnrichSourceKind, typeof Inbox> = {
  gmail: Inbox,
  slack: MessageSquare,
  linear: GitBranch,
  fireflies: Calendar,
  s2d: KanbanSquare,
};

export function WatchCanvas({
  item,
  active,
  prewarm,
  onExit,
  onOpenDetail,
}: CanvasBaseProps) {
  const checkIns = useWatchCheckIns(item.id, active);
  const updateItem = useUpdateS2DItem();
  const recordCheckIn = useRecordCheckIn(item.id);
  const pushArtifact = useSpawnedRail((s) => s.push);

  const [watchFor, setWatchFor] = useState(item.description ?? "");
  const [watchForDirty, setWatchForDirty] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<
    null | "still" | "resolved" | "stop" | "promote"
  >(null);

  // Re-hydrate watchFor when the slot promotes a different item.
  useEffect(() => {
    setWatchFor(item.description ?? "");
    setWatchForDirty(false);
    setNote("");
    setError(null);
  }, [item.id, item.description]);

  const signals: ActivitySignal[] = useMemo(
    () => checkIns.data?.signals ?? [],
    [checkIns.data?.signals]
  );
  const lastCheckInAt = checkIns.data?.lastCheckInAt ?? null;

  async function persistWatchFor() {
    const next = watchFor.trim();
    if (!watchForDirty || next === (item.description ?? "").trim()) return;
    try {
      await updateItem.mutateAsync({
        id: item.id,
        patch: { description: next },
      });
      setWatchForDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "save failed");
    }
  }

  async function stillWatching() {
    if (busy) return;
    setBusy("still");
    setError(null);
    try {
      await persistWatchFor();
      const { checkIn } = await recordCheckIn.mutateAsync({
        continue: true,
        note: note.trim() || undefined,
      });
      pushArtifact({
        kind: "check-in",
        itemId: item.id,
        label: "Still watching",
        detail: note.trim() || "Logged check-in, slot promoting next",
      });
      await onExit({
        kind: "check-in",
        continue: true,
        note: note.trim() || undefined,
      });
      void checkIn;
    } catch (e) {
      setError(e instanceof Error ? e.message : "check-in failed");
    } finally {
      setBusy(null);
    }
  }

  async function resolved() {
    if (busy) return;
    setBusy("resolved");
    setError(null);
    try {
      await persistWatchFor();
      await onExit({
        kind: "done",
        outcome: note.trim() || "Watching resolved",
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "resolve failed");
    } finally {
      setBusy(null);
    }
  }

  async function stopWatching() {
    if (busy) return;
    setBusy("stop");
    setError(null);
    try {
      await persistWatchFor();
      await recordCheckIn.mutateAsync({
        continue: false,
        note: note.trim() || undefined,
      });
      pushArtifact({
        kind: "check-in",
        itemId: item.id,
        label: "Stopped watching",
        detail: note.trim() || "Abandoned the watch",
      });
      await onExit({
        kind: "check-in",
        continue: false,
        note: note.trim() || undefined,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "stop failed");
    } finally {
      setBusy(null);
    }
  }

  async function promote(target: PromoteTarget) {
    if (busy) return;
    setBusy("promote");
    setError(null);
    try {
      await persistWatchFor();
      await updateItem.mutateAsync({
        id: item.id,
        patch: { pathway: target },
      });
      pushArtifact({
        kind: "follow-up",
        itemId: item.id,
        label: `Promoted to ${target === "quick_reply" ? "Reply" : "Decide"}`,
        detail: `Re-pathwayed from watching`,
      });
      await onExit({ kind: "repathway", newPathway: target });
    } catch (e) {
      setError(e instanceof Error ? e.message : "promote failed");
    } finally {
      setBusy(null);
    }
  }

  const lastCheckInLabel = useMemo(() => {
    if (!lastCheckInAt) return null;
    const ms = Date.now() - new Date(lastCheckInAt).getTime();
    if (ms < 60_000) return "just now";
    if (ms < 60 * 60_000) return `${Math.round(ms / 60_000)}m ago`;
    if (ms < 24 * 60 * 60_000) return `${Math.round(ms / 3_600_000)}h ago`;
    return `${Math.round(ms / (24 * 3_600_000))}d ago`;
  }, [lastCheckInAt]);

  return (
    <CanvasShell
      item={item}
      active={active}
      prewarm={prewarm}
      onExit={onExit}
      onOpenDetail={onOpenDetail}
      footerVariant="compact"
      primary={
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            onClick={stillWatching}
            disabled={!!busy}
            className="mashi-press h-7 gap-1.5 px-3 text-[11px]"
            title="Log a check-in; item stays in_queue, slot promotes next"
          >
            {busy === "still" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Eye className="h-3 w-3" />
            )}
            Still watching
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={resolved}
            disabled={!!busy}
            className="mashi-press h-7 gap-1.5 px-2 text-[11px]"
            title="Mark resolved — captures the note as the outcome"
          >
            {busy === "resolved" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Check className="h-3 w-3" />
            )}
            Resolved
          </Button>
          <PromotePopover busy={!!busy} onPick={promote} />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={stopWatching}
            disabled={!!busy}
            className="mashi-press h-7 gap-1.5 px-2 text-[11px] text-muted-foreground"
            title="Stop watching — abandons the watch with no resolution"
          >
            {busy === "stop" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <EyeOff className="h-3 w-3" />
            )}
            Stop watching
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <section className="rounded-md border border-border/40 bg-card/60 p-2.5">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            Watching for
          </div>
          <Textarea
            value={watchFor}
            onChange={(e) => {
              setWatchFor(e.target.value);
              setWatchForDirty(true);
            }}
            onBlur={persistWatchFor}
            rows={2}
            placeholder="What outcome are you waiting on? (e.g. 'Mihir confirms Q3 forecast number by Friday')"
            className="resize-none rounded border-border/40 bg-card/80 px-2 py-1.5 text-[11px] leading-snug placeholder:text-muted-foreground/60"
          />
        </section>

        <section className="rounded-md border border-border/40 bg-card/60 p-2.5">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Activity since last check-in
              {lastCheckInLabel && (
                <span className="ml-1 normal-case tracking-normal text-muted-foreground/70">
                  · {lastCheckInLabel}
                </span>
              )}
            </span>
            {checkIns.isFetching && (
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
            )}
          </div>
          {signals.length === 0 ? (
            <p className="rounded border border-dashed border-border/40 bg-card/55 p-3 text-[11px] text-muted-foreground">
              Nothing new since{" "}
              {lastCheckInLabel ?? "this item entered watching"}. Quiet is fine
              — log a check-in or stop watching.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {signals.map((s) => {
                const Icon = SOURCE_ICON[s.kind] ?? Inbox;
                return (
                  <li
                    key={`${s.kind}:${s.ref}`}
                    className="flex items-start gap-2 rounded border border-border/30 bg-card/60 px-2 py-1.5 text-[11px]"
                  >
                    <Icon className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-foreground/90">
                        {s.label}
                      </div>
                      {s.snippet && (
                        <div className="mt-0.5 line-clamp-2 text-muted-foreground">
                          {s.snippet}
                        </div>
                      )}
                      <div className="mt-0.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">
                        {s.kind} · {s.at.slice(0, 10)}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="rounded-md border border-border/40 bg-card/60 p-2.5">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            Check-in note
          </div>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Optional — what did you see? Surfaces in the sprint recap."
            className="resize-none rounded border-border/40 bg-card/80 px-2 py-1.5 text-[11px] leading-snug placeholder:text-muted-foreground/60"
          />
        </section>

        {error && <div className="text-[11px] text-destructive">{error}</div>}
      </div>
    </CanvasShell>
  );
}

function PromotePopover({
  busy,
  onPick,
}: {
  busy: boolean;
  onPick: (target: PromoteTarget) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          className={cn(
            "mashi-press h-7 gap-1.5 px-2 text-[11px]"
          )}
          title="Re-pathway this item from watching → action"
        >
          <ArrowUpRight className="h-3 w-3" />
          Promote
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        className="z-dropdown w-[220px] space-y-1 p-2"
      >
        <div className="px-1 pb-1 text-[9px] uppercase tracking-wider text-muted-foreground">
          Promote to action
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            onPick("quick_reply");
            setOpen(false);
          }}
          className="h-8 w-full justify-start gap-1.5 text-[11px]"
        >
          <span aria-hidden>⚡</span>
          Quick reply
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            onPick("decision_gate");
            setOpen(false);
          }}
          className="h-8 w-full justify-start gap-1.5 text-[11px]"
        >
          <span aria-hidden>◆</span>
          Decision gate
        </Button>
      </PopoverContent>
    </Popover>
  );
}
