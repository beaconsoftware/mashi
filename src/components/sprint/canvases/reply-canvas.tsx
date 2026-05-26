"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw, Send, Inbox, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { CanvasShell, type CanvasBaseProps } from "./_shared/canvas-shell";
import { useEnrichedContext } from "@/hooks/use-enriched-context";
import { useSpawnedRail } from "@/store/spawned-rail-store";

/**
 * ReplyCanvas — serves quick_reply + drafted_response.
 *
 * Layout (vertical):
 *   • Top:    inbound snippet (sender + when + 3-line preview, expandable)
 *   • Middle: editable Textarea, streams from /api/s2d/{id}/action
 *   • Bottom: tone pills · length slider · regenerate · Send
 *
 * Send fires `onExit({ kind: "send", ... })`. By default it also asks
 * the parent to spawn a `watching` follow-up (48h queue) — togglable
 * via the "Track a follow-up" checkbox above Send. The parent owns the
 * actual /api/s2d/[id]/send call, so re-pathway and bench keep clean
 * semantics.
 */

type Tone = "direct" | "warm" | "brief" | "detailed";
type Length = "short" | "standard" | "long";

const TONE_LABEL: Record<Tone, string> = {
  direct: "Direct",
  warm: "Warm",
  brief: "Brief",
  detailed: "Detailed",
};

const LENGTH_LABEL: Record<Length, string> = {
  short: "Short",
  standard: "Standard",
  long: "Long",
};

export function ReplyCanvas({
  item,
  active,
  prewarm,
  onExit,
  onOpenDetail,
}: CanvasBaseProps) {
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamErr, setStreamErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [tone, setTone] = useState<Tone>("direct");
  const [length, setLength] = useState<Length>("standard");
  const [trackFollowUp, setTrackFollowUp] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const pushArtifact = useSpawnedRail((s) => s.push);
  const enrich = useEnrichedContext(item.id, { polling: prewarm.status === "warming" });
  const replyDraftPrewarm = readReplyDraft(enrich.data?.enriched_context);

  const channel: "gmail" | "slack" | null =
    item.source_type === "gmail"
      ? "gmail"
      : item.source_type === "slack"
        ? "slack"
        : null;

  const actionKey =
    item.pathway === "quick_reply"
      ? "quick_reply_draft"
      : "drafted_response_prose";

  // Reset draft when the slot promotes a different item.
  useEffect(() => {
    setDraft(replyDraftPrewarm ?? "");
    setStreamErr(null);
    setSendError(null);
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, replyDraftPrewarm]);

  async function generate() {
    if (!active) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setStreaming(true);
    setStreamErr(null);
    setDraft("");
    let acc = "";
    try {
      const { streamPostText } = await import("@/lib/streaming");
      await streamPostText(
        `/api/s2d/${item.id}/action`,
        { action: actionKey, params: { tone, length } },
        (chunk) => {
          acc += chunk;
          setDraft(acc);
        },
        ctrl.signal
      );
    } catch (e) {
      if (!ctrl.signal.aborted) {
        setStreamErr(e instanceof Error ? e.message : "stream failed");
      }
    } finally {
      setStreaming(false);
    }
  }

  async function handleSend() {
    if (!channel || !draft.trim() || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const res = await fetch(`/api/s2d/${item.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: draft }),
      });
      const j = (await res.json()) as {
        ok?: boolean;
        channel?: "gmail" | "slack";
        message?: string;
        error?: string;
      };
      if (!res.ok || !j.ok) {
        setSendError(j.error ?? `send failed (${res.status})`);
        return;
      }
      pushArtifact({
        kind: "sent",
        itemId: item.id,
        label: `Sent via ${channel}`,
        detail:
          draft.length > 140 ? `${draft.slice(0, 137)}…` : draft,
      });
      await onExit({
        kind: "send",
        channel,
        body: draft,
        spawnsWatchItem: trackFollowUp,
      });
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "send failed");
    } finally {
      setSending(false);
    }
  }

  const sendDisabled =
    !channel || !draft.trim() || sending || streaming;
  const sendLabel =
    channel === "gmail"
      ? "Send via Gmail"
      : channel === "slack"
        ? "Send via Slack"
        : "Send";

  return (
    <CanvasShell
      item={item}
      active={active}
      prewarm={prewarm}
      onExit={onExit}
      onOpenDetail={onOpenDetail}
      footerVariant="compact"
      primary={
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Checkbox
              checked={trackFollowUp}
              onCheckedChange={(v) => setTrackFollowUp(v === true)}
            />
            Watch for reply (48h)
          </label>
          <Button
            type="button"
            size="sm"
            onClick={handleSend}
            disabled={sendDisabled}
            className="mashi-press h-7 gap-1.5 px-3 text-[11px]"
            title={
              !channel
                ? "Inline send not available for this source"
                : `Send via ${channel}`
            }
          >
            {sending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Send className="h-3 w-3" />
            )}
            {sending ? "Sending" : sendLabel}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <InboundSnippet
          sourceType={item.source_type}
          sender={item.source_label}
          description={item.description ?? ""}
        />

        <section>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Draft
            </span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={generate}
              disabled={streaming}
              className="mashi-press h-6 gap-1 px-2 text-[11px]"
              title="Stream a fresh draft using current tone + length"
            >
              {streaming ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              {streaming
                ? "Streaming"
                : draft
                  ? "Regenerate"
                  : "Generate"}
            </Button>
          </div>
          {!draft && !streaming && !streamErr && (
            <p className="rounded-md border border-dashed border-border/40 bg-card/55 p-3 text-[11px] text-muted-foreground">
              {prewarm.status === "warming"
                ? "Pre-warming your draft — it should land in a moment."
                : "Hit Generate to stream a draft. Tone and length below tune the prompt."}
            </p>
          )}
          {streamErr && (
            <div className="rounded border border-destructive/40 bg-destructive/15 p-2 text-[11px] text-destructive">
              {streamErr}
            </div>
          )}
          {(draft || streaming) && (
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={10}
              placeholder={streaming ? "Streaming…" : "Draft will appear here."}
              className="resize-none rounded-md border-border/40 bg-card/80 px-2.5 py-2 text-[12px] leading-snug"
            />
          )}
          {sendError && (
            <div className="mt-1 text-[10px] text-destructive">{sendError}</div>
          )}
        </section>

        <section className="space-y-2 rounded-md border border-border/40 bg-card/55 p-2.5">
          <div className="flex items-center gap-1.5">
            <span className="shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">
              Tone
            </span>
            <div className="flex flex-wrap gap-1">
              {(Object.keys(TONE_LABEL) as Tone[]).map((t) => (
                <Button
                  key={t}
                  type="button"
                  size="sm"
                  variant={tone === t ? "default" : "outline"}
                  onClick={() => setTone(t)}
                  className="mashi-press h-6 px-2 text-[10px]"
                >
                  {TONE_LABEL[t]}
                </Button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">
              Length
            </span>
            <Slider
              value={[lengthToIndex(length)]}
              min={0}
              max={2}
              step={1}
              onValueChange={(v) => setLength(indexToLength(v[0] ?? 1))}
              className="flex-1"
            />
            <span className="w-16 text-right text-[10px] text-muted-foreground">
              {LENGTH_LABEL[length]}
            </span>
          </div>
        </section>
      </div>
    </CanvasShell>
  );
}

function lengthToIndex(l: Length): number {
  return l === "short" ? 0 : l === "long" ? 2 : 1;
}
function indexToLength(i: number): Length {
  return i === 0 ? "short" : i === 2 ? "long" : "standard";
}

function InboundSnippet({
  sourceType,
  sender,
  description,
}: {
  sourceType?: string | null;
  sender?: string | null;
  description: string;
}) {
  const Icon = sourceType === "slack" ? MessageSquare : Inbox;
  const trimmed = description.trim();
  const preview = trimmed.length > 360 ? `${trimmed.slice(0, 357)}…` : trimmed;
  return (
    <section className="rounded-md border border-border/40 bg-card/60 p-2.5">
      <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3 w-3" />
        Inbound
        {sender && (
          <span className="normal-case tracking-normal text-foreground/80">
            · {sender}
          </span>
        )}
      </div>
      <p
        className={cn(
          "whitespace-pre-wrap text-[11px] leading-snug",
          preview ? "text-foreground/90" : "italic text-muted-foreground"
        )}
      >
        {preview || "No inbound snippet captured for this item."}
      </p>
    </section>
  );
}

interface EnrichedContextWithReplyDraft {
  reply_draft?: { body?: string };
}

function readReplyDraft(
  ctx: unknown
): string | null {
  if (!ctx || typeof ctx !== "object") return null;
  const candidate = (ctx as EnrichedContextWithReplyDraft).reply_draft;
  if (candidate && typeof candidate.body === "string") return candidate.body;
  return null;
}
