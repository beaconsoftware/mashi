"use client";

/**
 * Sprint slot toolkit. Renders the per-pathway action chips and the
 * expandable drawer where each action's preview gets streamed.
 *
 * Architecture:
 *   - Layer 1 brief is fetched via useItemBrief (cached per sprint).
 *   - Each chip click fires POST /api/s2d/:id/action with the action key
 *     and the cached brief.
 *   - The streamed preview lands in a textarea the user can edit before
 *     firing any state-changing follow-up (Send / Copy / Mark done).
 *   - Failures surface in an inline banner inside the drawer; no
 *     fire-and-forget mutations.
 */

import { useEffect, useRef, useState } from "react";
import {
  Sparkles,
  Loader2,
  Copy,
  Check,
  Send,
  RotateCw,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Thermometer,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useItemBrief } from "@/hooks/use-item-brief";
import { streamPostText } from "@/lib/streaming";
import {
  actionsForPathway,
  type ActionKey,
  type ActionMeta,
} from "@/lib/s2d/action-agents";
import { cn } from "@/lib/utils";
import type { S2DItem } from "@/types";

interface Props {
  item: S2DItem;
  /** When false, the brief fetch is deferred (e.g. card not yet active). */
  active?: boolean;
}

export function SprintToolkit({ item, active = true }: Props) {
  const briefQuery = useItemBrief(item.id, { enabled: active });
  const [openAction, setOpenAction] = useState<ActionKey | null>(null);
  const [expanded, setExpanded] = useState(false);

  const actions = actionsForPathway(item.pathway);
  const primary = actions.filter((a) => a.primary);
  const secondary = actions.filter((a) => !a.primary);

  const visibleChips = expanded ? actions : primary;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-primary">
        <Wand2 className="h-3 w-3" />
        Action toolkit
        {briefQuery.isFetching && (
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
        )}
        {briefQuery.data?.temperature && briefQuery.data.temperature !== "unknown" && (
          <span
            className={cn(
              "ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-normal",
              briefQuery.data.temperature === "escalating"
                ? "bg-destructive/15 text-destructive"
                : briefQuery.data.temperature === "cooled_off"
                  ? "bg-secondary/40 text-muted-foreground"
                  : "bg-secondary/40 text-foreground/70"
            )}
          >
            <Thermometer className="h-2.5 w-2.5" />
            {briefQuery.data.temperature.replace("_", " ")}
          </span>
        )}
      </div>

      {briefQuery.data?.recommended_next_move && (
        <div className="rounded-md border border-primary/30 bg-primary/5 px-2 py-1 text-[11px] text-foreground/85">
          <span className="text-[9px] uppercase tracking-wider text-primary">
            Suggested
          </span>{" "}
          {briefQuery.data.recommended_next_move}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {visibleChips.map((a) => (
          <Chip
            key={a.key}
            action={a}
            onClick={() => setOpenAction(a.key)}
            active={openAction === a.key}
          />
        ))}
        {!expanded && secondary.length > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="inline-flex items-center gap-1 rounded-md border border-dashed border-border/40 bg-card/40 px-2 py-1 text-[10px] text-muted-foreground hover:bg-secondary/40"
            title="Show all actions"
          >
            <ChevronDown className="h-2.5 w-2.5" />
            +{secondary.length} more
          </button>
        )}
        {expanded && (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="inline-flex items-center gap-1 rounded-md border border-border/40 bg-card/40 px-2 py-1 text-[10px] text-muted-foreground hover:bg-secondary/40"
          >
            <ChevronRight className="h-2.5 w-2.5" />
            collapse
          </button>
        )}
      </div>

      {openAction && (
        <ActionDrawer
          item={item}
          actionKey={openAction}
          actionMeta={actions.find((a) => a.key === openAction) ?? null}
          brief={briefQuery.data ?? null}
          onClose={() => setOpenAction(null)}
        />
      )}

      {briefQuery.isError && (
        <div className="flex items-start gap-1.5 rounded border border-destructive/30 bg-destructive/10 px-2 py-1 text-[10px] text-destructive">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            Brief failed:{" "}
            {briefQuery.error instanceof Error
              ? briefQuery.error.message
              : "unknown error"}
            . Actions will still work with raw context.
          </span>
        </div>
      )}
    </div>
  );
}

function Chip({
  action,
  onClick,
  active,
}: {
  action: ActionMeta;
  onClick: () => void;
  active: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={action.hint ?? action.label}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] transition-colors",
        active
          ? "border-primary/60 bg-primary/15 text-foreground"
          : "border-border/40 bg-card/60 text-foreground/80 hover:bg-secondary/40"
      )}
    >
      <Sparkles className="h-2.5 w-2.5" />
      {action.label}
    </button>
  );
}

function ActionDrawer({
  item,
  actionKey,
  actionMeta,
  brief,
  onClose,
}: {
  item: S2DItem;
  actionKey: ActionKey;
  actionMeta: ActionMeta | null;
  brief: ReturnType<typeof useItemBrief>["data"] | null;
  onClose: () => void;
}) {
  const [preview, setPreview] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    void run();
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionKey, item.id]);

  async function run() {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setStreaming(true);
    setErr(null);
    setPreview("");
    let acc = "";
    try {
      await streamPostText(
        `/api/s2d/${item.id}/action`,
        { action: actionKey, brief },
        (delta) => {
          acc += delta;
          setPreview(acc);
        },
        ctrl.signal
      );
    } catch (e) {
      if (!ctrl.signal.aborted) {
        setErr(e instanceof Error ? e.message : "stream failed");
      }
    } finally {
      setStreaming(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(preview);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setToast("Couldn't copy");
    }
  }

  /**
   * For draft-shaped actions on gmail/slack items, surface a Send button
   * that POSTs to /api/s2d/:id/send. Keeps the toolkit feeling actionable
   * without forcing the user to copy then paste then send.
   */
  const isDraftAction =
    actionKey === "quick_reply_draft" ||
    actionKey === "drafted_response_prose" ||
    actionKey === "delegated_check_in" ||
    actionKey === "watching_nudge";
  const canSendInline =
    isDraftAction &&
    (item.source_type === "gmail" || item.source_type === "slack");

  async function send() {
    if (!preview.trim() || !canSendInline) return;
    setSending(true);
    setToast(null);
    try {
      const res = await fetch(`/api/s2d/${item.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: preview }),
      });
      const data = await res.json();
      if (!res.ok) {
        setToast(data.error ?? `send failed (${res.status})`);
        return;
      }
      setToast(data.message ?? "Sent.");
    } catch (e) {
      setToast(e instanceof Error ? e.message : "send failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="rounded-md border border-primary/30 bg-card/80 p-2">
      <div className="mb-1.5 flex items-center gap-2">
        <Sparkles className="h-3 w-3 text-primary" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-foreground/80">
          {actionMeta?.label ?? actionKey}
        </span>
        {streaming && (
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
        )}
        <button
          type="button"
          onClick={onClose}
          className="ml-auto text-[10px] text-muted-foreground hover:text-foreground"
        >
          close
        </button>
      </div>

      <Textarea
        value={preview}
        onChange={(e) => setPreview(e.target.value)}
        rows={6}
        placeholder={streaming ? "Generating preview…" : "Preview will stream here…"}
        className="text-[12px] leading-relaxed"
      />

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {canSendInline && (
          <Button
            size="sm"
            onClick={send}
            disabled={sending || streaming || !preview.trim()}
            className="gap-1.5"
          >
            {sending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Send className="h-3 w-3" />
            )}
            {sending
              ? "Sending…"
              : item.source_type === "slack"
                ? "Send via Slack"
                : "Send via Gmail"}
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={copy}
          disabled={!preview.trim()}
          className="gap-1.5"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={run}
          disabled={streaming}
          className="gap-1.5 text-muted-foreground"
        >
          <RotateCw className={cn("h-3 w-3", streaming && "animate-spin")} />
          Regen
        </Button>
      </div>

      {err && (
        <div className="mt-1.5 flex items-start gap-1.5 rounded border border-destructive/30 bg-destructive/10 px-2 py-1 text-[10px] text-destructive">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>{err}</span>
        </div>
      )}
      {toast && (
        <div className="mt-1.5 text-[10px] text-muted-foreground">{toast}</div>
      )}
    </div>
  );
}
