"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Check,
  Loader2,
  Inbox,
  MessageSquare,
  Calendar,
  GitBranch,
  KanbanSquare,
  Send,
  ArrowDownToLine,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { CanvasShell, type CanvasBaseProps } from "./_shared/canvas-shell";
import { useWatchCheckIns } from "@/hooks/use-watch-check-ins";
import { useUpdateS2DItem } from "@/hooks/use-s2d";
import { useSpawnedRail } from "@/store/spawned-rail-store";
import type { EnrichSourceKind } from "@/hooks/use-enriched-context";
import type { Priority } from "@/types";

/**
 * DelegateCanvas — serves `delegated`.
 *
 * Mental model: someone else owns this. Did they move it?
 *
 * Layout:
 *   • Top:    who / when delegated / last-heard summary
 *   • Middle: activity timeline (since last update on the item)
 *   • Bottom: action buttons — Resolved · Send nudge · Pull back ·
 *             Check again tomorrow. The Send-nudge row expands to show
 *             a tone slider (Gentle / Direct / Escalate) + body
 *             textarea.
 *
 * Nudge is NOT a slot exit — the timer keeps running so the user can
 * follow up if the delegate replies fast. Resolved / Pull back / Check
 * again tomorrow ARE exits.
 *
 * Pre-warm draft: the contract card (Phase 5) writes
 * `enriched_context.nudge_draft.body` when the urgency-based silence
 * threshold has passed. Until then the textarea is empty.
 */

const URGENCY_DAYS: Record<string, number> = {
  urgent: 1,
  high: 3,
  medium: 7,
  low: 14,
};

const SOURCE_ICON: Record<EnrichSourceKind, typeof Inbox> = {
  gmail: Inbox,
  slack: MessageSquare,
  linear: GitBranch,
  fireflies: Calendar,
  s2d: KanbanSquare,
};

type Tone = "gentle" | "direct" | "escalate";
const TONE_LABEL: Record<Tone, string> = {
  gentle: "Gentle",
  direct: "Direct",
  escalate: "Escalate",
};
function indexToTone(i: number): Tone {
  return i === 0 ? "gentle" : i === 2 ? "escalate" : "direct";
}
function toneToIndex(t: Tone): number {
  return t === "gentle" ? 0 : t === "escalate" ? 2 : 1;
}

export function DelegateCanvas({
  item,
  active,
  prewarm,
  onExit,
  onOpenDetail,
}: CanvasBaseProps) {
  // We piggyback on the watch check-ins activity scan — same payload
  // shape, same "what happened since" intent. The scan also matches
  // delegate name in messages/calendar via the API server-side.
  const activity = useWatchCheckIns(item.id, active);
  const updateItem = useUpdateS2DItem();
  const pushArtifact = useSpawnedRail((s) => s.push);

  const [nudgeOpen, setNudgeOpen] = useState(false);
  const [nudgeBody, setNudgeBody] = useState("");
  const [tone, setTone] = useState<Tone>("direct");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "resolved" | "pullback" | "later">(null);

  // Hydrate from any pre-warmed draft on slot promotion.
  useEffect(() => {
    setNudgeOpen(false);
    setNudgeBody("");
    setTone("direct");
    setError(null);
  }, [item.id]);

  const signals = useMemo(() => activity.data?.signals ?? [], [activity.data]);

  const lastUpdateLabel = useMemo(() => {
    const at = item.last_update_at ?? item.updated_at;
    if (!at) return null;
    const ms = Date.now() - new Date(at).getTime();
    if (ms < 60_000) return "just now";
    if (ms < 60 * 60_000) return `${Math.round(ms / 60_000)}m ago`;
    if (ms < 24 * 60 * 60_000) return `${Math.round(ms / 3_600_000)}h ago`;
    return `${Math.round(ms / (24 * 3_600_000))}d ago`;
  }, [item.last_update_at, item.updated_at]);

  const silenceDays = useMemo(() => {
    const at = item.last_update_at ?? item.updated_at;
    if (!at) return 0;
    return Math.floor(
      (Date.now() - new Date(at).getTime()) / (24 * 60 * 60 * 1000)
    );
  }, [item.last_update_at, item.updated_at]);
  const nudgeThresholdDays =
    URGENCY_DAYS[item.priority as Priority] ?? URGENCY_DAYS.medium;
  const nudgeOverdue = silenceDays >= nudgeThresholdDays;

  const channel: "gmail" | "slack" =
    item.source_type === "slack" ? "slack" : "gmail";

  async function sendNudge() {
    const trimmed = nudgeBody.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/s2d/${item.id}/nudge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: trimmed, channel, tone }),
      });
      const j = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !j.ok) {
        throw new Error(j.error ?? `nudge failed (${res.status})`);
      }
      pushArtifact({
        kind: "nudge",
        itemId: item.id,
        label: `Nudged ${item.delegated_to ?? "delegate"}`,
        detail:
          trimmed.length > 140 ? `${trimmed.slice(0, 137)}…` : trimmed,
      });
      setNudgeBody("");
      setNudgeOpen(false);
      // Refresh activity so the new outbound nudge surfaces.
      await activity.refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : "nudge failed");
    } finally {
      setSending(false);
    }
  }

  async function resolved() {
    if (busy) return;
    setBusy("resolved");
    setError(null);
    try {
      await onExit({
        kind: "done",
        outcome: `Delegate resolved: ${item.delegated_to ?? "owner"} closed it out`,
      });
    } finally {
      setBusy(null);
    }
  }

  async function pullBack() {
    if (busy) return;
    setBusy("pullback");
    setError(null);
    try {
      await updateItem.mutateAsync({
        id: item.id,
        patch: { pathway: "heads_down", delegated_to: null },
      });
      pushArtifact({
        kind: "follow-up",
        itemId: item.id,
        label: "Pulled back from delegate",
        detail: "Re-pathwayed to heads_down",
      });
      await onExit({ kind: "repathway", newPathway: "heads_down" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "pullback failed");
    } finally {
      setBusy(null);
    }
  }

  async function checkAgainTomorrow() {
    if (busy) return;
    setBusy("later");
    setError(null);
    try {
      const t = new Date();
      t.setDate(t.getDate() + 1);
      t.setHours(9, 0, 0, 0);
      await onExit({ kind: "snooze", until: t.toISOString() });
    } finally {
      setBusy(null);
    }
  }

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
            onClick={resolved}
            disabled={!!busy}
            className="mashi-press h-7 gap-1.5 px-3 text-[11px]"
            title="Delegate resolved this — close the item terminally"
          >
            {busy === "resolved" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Check className="h-3 w-3" />
            )}
            Resolved
          </Button>
          <Button
            type="button"
            size="sm"
            variant={nudgeOpen ? "default" : "outline"}
            onClick={() => setNudgeOpen((o) => !o)}
            className="mashi-press h-7 gap-1.5 px-2 text-[11px]"
            title="Draft a nudge — timer keeps running"
          >
            <Send className="h-3 w-3" />
            {nudgeOpen ? "Hide nudge" : "Send nudge"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={pullBack}
            disabled={!!busy}
            className="mashi-press h-7 gap-1.5 px-2 text-[11px] text-muted-foreground"
            title="Pull this back from the delegate and own it yourself"
          >
            {busy === "pullback" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Undo2 className="h-3 w-3" />
            )}
            Pull back
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={checkAgainTomorrow}
            disabled={!!busy}
            className="mashi-press h-7 gap-1.5 px-2 text-[11px] text-muted-foreground"
            title="Snooze until tomorrow morning"
          >
            {busy === "later" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <ArrowDownToLine className="h-3 w-3" />
            )}
            Check again
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <section className="rounded-md border border-border/40 bg-card/60 p-2.5">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            Delegate
          </div>
          <div className="text-[13px] font-medium text-foreground">
            {item.delegated_to ?? "(not yet recorded)"}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
            {lastUpdateLabel && (
              <span>Last activity {lastUpdateLabel}</span>
            )}
            <span
              className={cn(
                "rounded px-1.5 py-0.5 font-mono uppercase tracking-wider",
                nudgeOverdue
                  ? "bg-destructive/15 text-destructive"
                  : "bg-secondary/40 text-muted-foreground"
              )}
              title={`Threshold for ${item.priority}: ${nudgeThresholdDays}d`}
            >
              {nudgeOverdue
                ? `silent ${silenceDays}d — overdue`
                : `silent ${silenceDays}d`}
            </span>
          </div>
        </section>

        <section className="rounded-md border border-border/40 bg-card/60 p-2.5">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Activity timeline
            </span>
            {activity.isFetching && (
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
            )}
          </div>
          {signals.length === 0 ? (
            <p className="rounded border border-dashed border-border/40 bg-card/55 p-3 text-[11px] text-muted-foreground">
              Nothing from {item.delegated_to ?? "the delegate"} since
              hand-off. {nudgeOverdue ? "Worth a nudge." : "Patience."}
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

        {nudgeOpen && (
          <section className="space-y-2 rounded-md border border-border/40 bg-card/60 p-2.5">
            <div className="flex items-center gap-2">
              <span className="shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">
                Tone
              </span>
              <Slider
                value={[toneToIndex(tone)]}
                min={0}
                max={2}
                step={1}
                onValueChange={(v) => setTone(indexToTone(v[0] ?? 1))}
                className="flex-1"
              />
              <span className="w-16 text-right text-[10px] text-muted-foreground">
                {TONE_LABEL[tone]}
              </span>
            </div>
            <Textarea
              value={nudgeBody}
              onChange={(e) => setNudgeBody(e.target.value)}
              rows={4}
              placeholder={`Hi ${item.delegated_to ?? "there"} — circling back on this. Any update?`}
              className="resize-none rounded border-border/40 bg-card/80 px-2 py-1.5 text-[11px] leading-snug placeholder:text-muted-foreground/60"
            />
            <div className="flex items-center justify-end gap-1.5">
              <Button
                type="button"
                size="sm"
                onClick={sendNudge}
                disabled={!nudgeBody.trim() || sending}
                className="mashi-press h-7 gap-1.5 px-3 text-[11px]"
                title={`Send nudge via ${channel} — timer keeps running`}
              >
                {sending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Send className="h-3 w-3" />
                )}
                {sending
                  ? "Sending"
                  : `Send nudge via ${channel === "gmail" ? "Gmail" : "Slack"}`}
              </Button>
            </div>
          </section>
        )}

        {error && <div className="text-[11px] text-destructive">{error}</div>}
      </div>
    </CanvasShell>
  );
}
