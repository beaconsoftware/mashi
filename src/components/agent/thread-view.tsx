"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RotateCcw, Sparkles } from "lucide-react";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
  type ToolPartState,
} from "@/components/ai-elements/tool";
import {
  Suggestion,
  Suggestions,
} from "@/components/ai-elements/suggestion";
import { useCursorContext } from "@/lib/agent/cursor-context";
import { deriveSources, type SourceDescriptor } from "@/lib/agent/provenance";
import {
  isCancelledResult,
  isExpiredResult,
} from "@/lib/agent/approval-meta";
import { CopyButton } from "@/components/agent/copy-button";
import { MessageSources } from "@/components/agent/message-sources";
import { ThreadExport } from "@/components/agent/thread-export";
import { EditableUserMessage } from "@/components/agent/editable-user-message";
import { Button } from "@/components/ui/button";
import { AgentComposer } from "@/components/agent/composer";
import { StoredAttachmentList } from "@/components/agent/attachment-chip";
import { ReferenceChipList } from "@/components/agent/reference-chip";
import type { AttachmentDescriptor } from "@/lib/agent/attachments";
import type { AgentReference } from "@/lib/agent/references";
import { UndoStrip, type UndoableAction } from "@/components/agent/undo-strip";
import {
  ApprovalCard,
  type PendingApproval,
} from "@/components/agent/approval-card";
import {
  FollowUpCard,
  type PendingFollowUp,
} from "@/components/agent/follow-up-card";
import { ThreadSummaryCard } from "@/components/agent/thread-summary-card";
import { ModeToggle } from "@/components/agent/mode-toggle";
import type { AgentDelta } from "@/lib/agent/loop";
import {
  type AgentMode,
  threadKey,
  useAgentThread,
} from "@/store/agent-thread-store";

interface AgentMessageRow {
  id: string;
  thread_id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string | null;
  tool_calls: Array<{ id: string; name: string; input: unknown }> | null;
  tool_results:
    | Array<{ tool_use_id: string; content: string; is_error: boolean }>
    | null;
  created_at: string;
  /** P1: optional annotations stamped on the exceptional loop paths
   * (A8 error/retryable, A3 cancelled, A9 truncated, A6 budget). */
  metadata?: {
    error?: string;
    retryable?: boolean;
    cancelled?: boolean;
    truncated?: boolean;
    budget_exhausted?: boolean;
  } | null;
  /** B1 (P3): attachments on a user row. */
  attachments?: AttachmentDescriptor[] | null;
  /** B2 (P3): pinned @-mention references on a user row. */
  pinned_references?: AgentReference[] | null;
}

/** A4/A6/A9 non-fatal, turn-level note rendered inline below the live turn. */
interface TurnNotice {
  id: string;
  level: "info" | "warn";
  message: string;
  code?: string;
}

interface ThreadData {
  thread: {
    id: string;
    title: string;
    summary: string | null;
    created_at?: string | null;
    mode?: AgentMode;
  } | null;
  messages: AgentMessageRow[];
}

interface InFlightToolCall {
  id: string;
  name: string;
  args?: unknown;
  result?: unknown;
  error?: string;
  ok?: boolean;
}

const EMPTY_STATE_SUGGESTIONS = [
  "what is this about?",
  "summarize the last reply",
  "what should I do here?",
];

/**
 * Renders an agent thread plus the composer. Drives both:
 *   - item-bound threads (via `itemId` — Ask Mashi sheet, Phase 2)
 *   - orphan threads (via `threadId` — Spotlight, Phase 4). The
 *     by-id endpoints don't auto-create; the caller is expected to
 *     have created the orphan row already (POST /api/agent/threads/
 *     orphan) and pass us its id.
 *
 * Loading strategy is identical in both cases: GET to load, POST to
 * /messages to stream SSE deltas. The "live" assistant text plus
 * in-flight tool-call rows render on top of the persisted message
 * list; once the stream ends we invalidate the query so the next
 * render picks up the durable rows the server wrote.
 *
 * Visual chrome is provided by AI Elements primitives (Conversation,
 * Message, Reasoning, Tool, Suggestions) installed at src/components/
 * ai-elements/. Pre-tool narration renders inside <Reasoning> (subtle,
 * collapsible); the final answer renders inside <Message> (prominent).
 * Tool cards default to collapsed via <Tool defaultOpen={false}>.
 */
export function ThreadView({
  itemId,
  threadId,
  onItemBound,
  initialMessage,
  initialAttachments,
  initialReferences,
}: {
  itemId?: string;
  threadId?: string;
  /** Fired when an orphan thread becomes item-bound mid-conversation
   * (attach_thread_to_item). The Spotlight surface uses this to swap
   * over to the item-bound sheet for subsequent turns. */
  onItemBound?: (itemId: string) => void;
  /** First message to send the moment this thread mounts. Used by the
   * Spotlight Ask Mashi flow: the user types in the dialog composer,
   * we create the orphan row, then hand the message to ThreadView so
   * it owns the send (optimistic bubble + streaming) instead of
   * AskMashiTab racing the mount with a parallel POST. Fires once per
   * thread; guarded by a per-thread ref so re-renders don't re-send. */
  initialMessage?: string;
  /** B1 (P3): attachments to send with the first message (Spotlight Ask
   * flow uploads them in its composer before the thread row exists). */
  initialAttachments?: AttachmentDescriptor[];
  /** B2 (P3): pinned references to send with the first message (Spotlight
   * Ask flow pins them in its composer before the thread row exists). */
  initialReferences?: AgentReference[];
}) {
  if (!itemId && !threadId) {
    throw new Error("ThreadView requires either itemId or threadId");
  }
  const baseEndpoint = threadId
    ? `/api/agent/threads/by-id/${threadId}`
    : `/api/agent/threads/${itemId}`;
  const queryKey = threadId
    ? ["agent-thread-by-id", threadId]
    : ["agent-thread", itemId];

  const cursor = useCursorContext();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery<ThreadData>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(baseEndpoint, { credentials: "include" });
      if (!res.ok) throw new Error(`thread fetch ${res.status}`);
      return res.json();
    },
    staleTime: 1_000,
  });

  // Quality Phase 3: the toggle's optimistic state lives in the store
  // and only gets written when the user actually flips it; until then
  // we read from the persisted thread row. activeMode is the resolved
  // value used by every downstream surface (composer placeholder, plan
  // banner). The store layer prevents flicker after a flip + refetch.
  const key = threadKey({ itemId, threadId });
  const storedMode = useAgentThread((s) => s.modeByThread[key]);
  const persistedMode: AgentMode = data?.thread?.mode ?? "act";
  const activeMode: AgentMode = storedMode ?? persistedMode;

  const [liveText, setLiveText] = useState("");
  const [liveToolCalls, setLiveToolCalls] = useState<InFlightToolCall[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A4/A6/A9: non-fatal turn notices (retry hiccup, truncation, budget).
  const [notices, setNotices] = useState<TurnNotice[]>([]);
  // A3: AbortController for the in-flight turn. The Stop button and unmount
  // both abort it, which tears down the fetch and (via req.signal on the
  // server) cancels the upstream model call + approval poll.
  const abortRef = useRef<AbortController | null>(null);
  // Optimistic user message bubble. Rendered as soon as the user
  // submits and cleared once the post-stream refetch lands. Without
  // this, the user's typed text disappears from the composer and
  // doesn't reappear in the transcript until the persisted query
  // refetches — visible flicker after every send.
  const [pendingUserMessage, setPendingUserMessage] = useState<{
    text: string;
    attachments?: AttachmentDescriptor[];
    references?: AgentReference[];
  } | null>(null);
  const [undoables, setUndoables] = useState<UndoableAction[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  // Quality Phase 1: the model can ask one focused follow-up question
  // via the ask_followup_question tool. We track the unanswered one (at
  // most one is in flight at a time — the loop short-circuits after
  // emitting it) and render a chip-list card. Cleared when an option is
  // picked or a free-text turn lands.
  const [pendingFollowUps, setPendingFollowUps] = useState<PendingFollowUp[]>(
    []
  );

  // After an undo (or expiry), drop the strip and refresh the s2d
  // board cache so the optimistic update / revert is reflected
  // wherever the item is shown.
  const dropUndoable = (token: string, refresh: boolean) => {
    setUndoables((prev) => prev.filter((u) => u.token !== token));
    if (refresh) {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ["s2d_items"] });
      queryClient.invalidateQueries({ queryKey: ["s2d-items"] });
    }
  };

  // Tool results keyed by tool_use_id, indexed across all "tool" role
  // messages so the renderer can co-locate the result with its call
  // even when they land in different messages.
  const resultByCallId = useMemo(() => {
    const map = new Map<
      string,
      { tool_use_id: string; content: string; is_error: boolean }
    >();
    for (const m of data?.messages ?? []) {
      if (m.role === "tool" && Array.isArray(m.tool_results)) {
        for (const r of m.tool_results) map.set(r.tool_use_id, r);
      }
    }
    return map;
  }, [data?.messages]);

  // Derive any pending follow-up from persisted messages. A follow-up is
  // "pending" if the latest assistant turn called ask_followup_question
  // and no subsequent user message has landed. Walking newest-first: a
  // user message before any assistant tool_use means the prior question
  // was answered, so we stop. This is what keeps the card alive across
  // page reloads even though no live SSE delta is replayed.
  const persistedFollowUps = useMemo<PendingFollowUp[]>(() => {
    const msgs = data?.messages ?? [];
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m.role === "user") return [];
      if (m.role === "assistant" && Array.isArray(m.tool_calls)) {
        const followUps: PendingFollowUp[] = [];
        for (const tc of m.tool_calls) {
          if (tc.name !== "ask_followup_question") continue;
          const input = tc.input as
            | { question?: unknown; options?: unknown }
            | null;
          const question =
            input && typeof input.question === "string" ? input.question : null;
          if (!question) continue;
          const options =
            input && Array.isArray(input.options)
              ? input.options.filter(
                  (o): o is string => typeof o === "string"
                )
              : undefined;
          followUps.push({ id: tc.id, question, options });
        }
        if (followUps.length > 0) return followUps;
      }
    }
    return [];
  }, [data?.messages]);

  // Live (just-streamed) follow-ups merged with persisted ones, deduped
  // by tool_use_id. The live ones fill the gap before the persisted
  // query refetches; once it does, both refer to the same call id and
  // the persisted state takes over.
  const followUpsToRender = useMemo<PendingFollowUp[]>(() => {
    const seen = new Set<string>();
    const all: PendingFollowUp[] = [];
    for (const fu of pendingFollowUps) {
      if (seen.has(fu.id)) continue;
      seen.add(fu.id);
      all.push(fu);
    }
    for (const fu of persistedFollowUps) {
      if (seen.has(fu.id)) continue;
      seen.add(fu.id);
      all.push(fu);
    }
    return all;
  }, [pendingFollowUps, persistedFollowUps]);

  // A3: abort the in-flight turn. The fetch read loop unwinds, the server
  // sees req.signal abort and persists the partial answer, and we refetch
  // to show it. No error is surfaced for a user-initiated stop.
  function stop() {
    abortRef.current?.abort();
  }

  // A3: abort any in-flight turn when the thread view unmounts (sheet
  // closed, route change) so a backgrounded turn doesn't keep spending.
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  async function streamAgentTurn(
    url: string,
    body: unknown,
    // P2.b: fired once the server accepts the turn (200 + stream). Regenerate
    // and Edit use it to optimistically drop the discarded rows only after
    // the re-run is accepted, so a guard rejection (409) leaves the thread
    // untouched instead of flashing rows out and back.
    onAccepted?: () => void
  ) {
    if (streaming) return;
    setStreaming(true);
    setLiveText("");
    setLiveToolCalls([]);
    setPendingApprovals([]);
    setPendingFollowUps([]);
    setNotices([]);
    setError(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(url, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (res.status === 409) {
        // A1: another turn already holds this thread's lock (a second
        // tab, or a double-send). Non-destructive: surface a calm note
        // and leave whatever is already on screen untouched. Nothing was
        // persisted, so the user can resend once the other turn settles.
        const payload = (await res.json().catch(() => null)) as
          | { message?: string }
          | null;
        setError(
          payload?.message ??
            "Mashi is still working on this thread in another tab."
        );
        setStreaming(false);
        setPendingUserMessage(null);
        return;
      }
      if (!res.ok || !res.body) {
        // Surface the server's message when it sent one (e.g. the D2/D3
        // committed-write guard), else a generic reachability note.
        const payload = (await res.json().catch(() => null)) as
          | { message?: string }
          | null;
        setError(payload?.message ?? `Couldn't reach Mashi (${res.status}).`);
        setStreaming(false);
        setPendingUserMessage(null);
        return;
      }
      // Accepted: now safe to apply any optimistic truncation.
      onAccepted?.();
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n\n")) !== -1) {
          const frame = buf.slice(0, nl);
          buf = buf.slice(nl + 2);
          const line = frame
            .split("\n")
            .find((l) => l.startsWith("data: "));
          if (!line) continue;
          const payload = line.slice(6).trim();
          if (!payload) continue;
          let delta: AgentDelta;
          try {
            delta = JSON.parse(payload);
          } catch {
            continue;
          }
          applyDelta(delta);
        }
      }
    } catch (err) {
      // A3: a user-initiated Stop aborts the fetch; that's not an error.
      // The server persisted whatever streamed; the finally refetch shows
      // it. Any other failure surfaces normally.
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : "stream failed");
      }
    } finally {
      // Wait for the refetch to land BEFORE we clear live state. If we
      // clear first, the just-streamed assistant turn (or the partial
      // preserved on a Stop) disappears for the duration of the refetch
      // and pops back in from persisted data — a very visible flicker.
      // Awaiting refetchQueries keeps the live render up while the durable
      // rows arrive.
      try {
        await queryClient.refetchQueries({ queryKey });
      } catch {
        // Non-fatal: the next natural refetch will reconcile.
      }
      abortRef.current = null;
      setStreaming(false);
      setLiveText("");
      setLiveToolCalls([]);
      setPendingUserMessage(null);
    }
  }

  async function send(
    message: string,
    attachments?: AttachmentDescriptor[],
    references?: AgentReference[]
  ) {
    // B1: a turn is valid with text, attachments, or both.
    if ((!message.trim() && !(attachments?.length ?? 0)) || streaming) return;
    // Render the user message immediately so the composer-clear ↔
    // refetch-arrive gap doesn't blink the message out of existence.
    setPendingUserMessage({ text: message, attachments, references });
    await streamAgentTurn(`${baseEndpoint}/messages`, {
      message,
      attachments,
      references,
      cursor,
      mode: activeMode,
    });
  }

  // P2.b: optimistically drop every cached message after `anchorId` (and
  // optionally rewrite the anchor's content for an edit), so the discarded
  // turn disappears the moment a re-run is accepted instead of lingering
  // beside the new streaming answer. The post-stream refetch reconciles
  // against the server's durable rows.
  function optimisticTruncate(anchorId: string, editedContent?: string) {
    queryClient.setQueryData<ThreadData>(queryKey, (prev) => {
      if (!prev) return prev;
      const idx = prev.messages.findIndex((m) => m.id === anchorId);
      if (idx < 0) return prev;
      const kept = prev.messages.slice(0, idx + 1).map((m, i) =>
        i === idx && editedContent !== undefined
          ? { ...m, content: editedContent }
          : m
      );
      return { ...prev, messages: kept };
    });
  }

  // D2: re-run the last turn from the prior user message. The server
  // truncates the trailing assistant + tool rows and re-streams; it refuses
  // (409) if that turn already took a write action.
  async function regenerate() {
    if (streaming) return;
    const msgs = data?.messages ?? [];
    let anchorId: string | null = null;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === "user") {
        anchorId = msgs[i].id;
        break;
      }
    }
    await streamAgentTurn(
      `${baseEndpoint}/regenerate`,
      { cursor, mode: activeMode },
      anchorId ? () => optimisticTruncate(anchorId!) : undefined
    );
  }

  // D3: edit a prior user message and re-run from there.
  async function editAndResend(messageId: string, content: string) {
    if (streaming) return;
    await streamAgentTurn(
      `${baseEndpoint}/edit`,
      { messageId, content, cursor, mode: activeMode },
      () => optimisticTruncate(messageId, content)
    );
  }

  // Regenerate is available when the thread is idle and its last live turn
  // is an assistant answer (nothing to redo on an empty thread or right
  // after a user message that hasn't been answered).
  const lastRole = data?.messages.at(-1)?.role;
  const canRegenerate =
    !streaming &&
    !pendingUserMessage &&
    followUpsToRender.length === 0 &&
    pendingApprovals.length === 0 &&
    lastRole === "assistant";

  // Auto-fire the first message when ThreadView is handed one. Used by
  // the Spotlight Ask Mashi flow: AskMashiTab creates the orphan row,
  // then mounts us with the user's typed text — we own the send from
  // here so the optimistic bubble + streaming render in this view.
  // Per-thread ref guard: if React re-runs the effect (StrictMode, key
  // change without unmount, etc.) we don't double-send.
  const firedInitialRef = useRef<string | null>(null);
  useEffect(() => {
    const hasInitial =
      (initialMessage && initialMessage.trim().length > 0) ||
      (initialAttachments?.length ?? 0) > 0;
    if (!hasInitial) return;
    const k = threadId ?? itemId ?? "";
    if (!k || firedInitialRef.current === k) return;
    firedInitialRef.current = k;
    void send(initialMessage ?? "", initialAttachments, initialReferences);
    // `send` closes over streaming + activeMode + cursor by design — we
    // only want this to fire once per thread when the initial message
    // first arrives, so we don't include it in deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMessage, threadId, itemId]);

  async function pickFollowUp(followUpId: string, option: string) {
    if (streaming) return;
    await streamAgentTurn(`${baseEndpoint}/follow-up/${followUpId}`, {
      chosen: option,
      cursor,
      mode: activeMode,
    });
  }

  function applyDelta(d: AgentDelta) {
    if (d.kind === "text") {
      setLiveText((prev) => prev + d.text);
    } else if (d.kind === "tool_call_start") {
      setLiveToolCalls((prev) => [
        ...prev,
        { id: d.id, name: d.name },
      ]);
    } else if (d.kind === "tool_call_args") {
      setLiveToolCalls((prev) =>
        prev.map((c) => (c.id === d.id ? { ...c, args: d.args } : c))
      );
    } else if (d.kind === "tool_call_result") {
      setLiveToolCalls((prev) => {
        const next = prev.map((c) =>
          c.id === d.id
            ? { ...c, ok: d.ok, result: d.result, error: d.error }
            : c
        );
        // Detect orphan->bound transition. When attach_thread_to_item
        // succeeds, swap the Spotlight surface to its item-bound twin
        // so the next turn uses the existing item-keyed routes.
        if (onItemBound && d.ok) {
          const finished = next.find((c) => c.id === d.id);
          if (
            finished?.name === "attach_thread_to_item" &&
            typeof finished.args === "object" &&
            finished.args != null &&
            "item_id" in finished.args
          ) {
            const result = d.result as { ok?: boolean } | undefined;
            if (result?.ok) {
              const newItemId = (finished.args as { item_id: string }).item_id;
              if (typeof newItemId === "string" && newItemId.length > 0) {
                onItemBound(newItemId);
              }
            }
          }
        }
        return next;
      });
    } else if (d.kind === "follow-up-question") {
      // Model asked a focused clarification. Surface the card; the loop
      // has already short-circuited and is waiting on the user.
      setPendingFollowUps((prev) =>
        prev.some((p) => p.id === d.id)
          ? prev
          : [
              ...prev,
              {
                id: d.id,
                question: d.question,
                options: d.options,
              },
            ]
      );
    } else if (d.kind === "approval-needed") {
      // Ring 3 call paused — surface an inline approval card for the
      // user to Approve / Edit / Cancel. The loop is blocked polling
      // agent_approvals; the card POSTs the decision to flip it.
      setPendingApprovals((prev) => [
        ...prev,
        {
          id: d.id,
          name: d.name,
          args: (d.args as Record<string, unknown>) ?? {},
          expiresAt: d.expiresAt,
          context: d.context,
        },
      ]);
    } else if (d.kind === "approval-resolved") {
      setPendingApprovals((prev) => prev.filter((p) => p.id !== d.id));
    } else if (d.kind === "undoable") {
      // Ring 2 write landed. Surface the strip and refresh any board
      // queries so the optimistic mutation paints through immediately.
      setUndoables((prev) => [
        ...prev,
        {
          token: d.token,
          summary: d.summary,
          expiresAt: d.expiresAt,
          toolName: d.toolName,
        },
      ]);
      queryClient.invalidateQueries({ queryKey: ["s2d_items"] });
      queryClient.invalidateQueries({ queryKey: ["s2d-items"] });
    } else if (d.kind === "notice") {
      // A4/A6/A9 non-fatal note (retry hiccup, truncation, budget). Render
      // inline without killing the stream. Dedupe consecutive identical
      // notices (repeated retry hiccups) so they don't pile up.
      setNotices((prev) =>
        prev.length > 0 &&
        prev[prev.length - 1].message === d.message &&
        prev[prev.length - 1].code === d.code
          ? prev
          : [
              ...prev,
              {
                id: `${d.code ?? "note"}-${prev.length}-${Date.now()}`,
                level: d.level,
                message: d.message,
                code: d.code,
              },
            ]
      );
    } else if (d.kind === "error") {
      setError(d.message);
    }
  }

  // Empty UI state happens when there's no persisted history AND no
  // live activity. Shows suggestion chips that submit through the same
  // path as the composer.
  const showEmpty =
    !isLoading &&
    (data?.messages.length ?? 0) === 0 &&
    !streaming &&
    !liveText &&
    liveToolCalls.length === 0 &&
    !pendingUserMessage;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex items-center justify-end gap-1">
        {(data?.messages.length ?? 0) > 0 && data?.thread && (
          <ThreadExport
            thread={{
              id: data.thread.id,
              title: data.thread.title,
              created_at: data.thread.created_at ?? null,
            }}
            messages={data.messages}
          />
        )}
        <ModeToggle
          itemId={itemId}
          threadId={threadId}
          initialMode={persistedMode}
        />
      </div>
      <Conversation className="flex-1 rounded-md border border-border/40 bg-card/55">
        <ConversationContent className="gap-3 p-3">
          {data?.thread?.summary && (
            <ThreadSummaryCard
              summary={data.thread.summary}
              threadCreatedAt={data.thread.created_at ?? null}
            />
          )}
          {isLoading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading conversation…
            </div>
          )}
          {showEmpty && (
            <ConversationEmptyState
              icon={<Sparkles className="h-5 w-5 text-primary" />}
              title="Ask Mashi about this"
              description="Ask, decide, snooze, send."
            >
              <div className="flex flex-col items-center gap-3 text-center">
                <Sparkles className="h-5 w-5 text-primary" />
                <div className="space-y-1">
                  <h3 className="text-sm font-medium">Ask Mashi about this</h3>
                  <p className="text-xs text-muted-foreground">
                    Ask, decide, snooze, send.
                  </p>
                </div>
                <Suggestions>
                  {EMPTY_STATE_SUGGESTIONS.map((s) => (
                    <Suggestion key={s} suggestion={s} onClick={send} />
                  ))}
                </Suggestions>
              </div>
            </ConversationEmptyState>
          )}
          {data?.messages.map((m) => (
            <PersistedMessageRow
              key={m.id}
              message={m}
              resultByCallId={resultByCallId}
              streaming={streaming}
              onEditUser={editAndResend}
            />
          ))}
          {canRegenerate && (
            <div className="flex justify-start">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={regenerate}
                className="mashi-press h-6 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground"
              >
                <RotateCcw className="h-3 w-3" />
                Regenerate
              </Button>
            </div>
          )}
          {pendingUserMessage && (
            <div className="space-y-1.5">
              {pendingUserMessage.references &&
                pendingUserMessage.references.length > 0 && (
                  <ReferenceChipList
                    references={pendingUserMessage.references}
                    className="justify-end"
                  />
                )}
              {pendingUserMessage.attachments &&
                pendingUserMessage.attachments.length > 0 && (
                  <StoredAttachmentList
                    attachments={pendingUserMessage.attachments}
                  />
                )}
              {pendingUserMessage.text.trim().length > 0 && (
                <Message from="user">
                  <MessageContent>
                    <p className="whitespace-pre-wrap text-sm">
                      {pendingUserMessage.text}
                    </p>
                  </MessageContent>
                </Message>
              )}
            </div>
          )}
          {streaming && (
            <LiveTurnRows
              liveText={liveText}
              liveToolCalls={liveToolCalls}
            />
          )}
          {followUpsToRender.length > 0 && (
            <div className="space-y-1.5">
              {followUpsToRender.map((fu) => (
                <FollowUpCard
                  key={fu.id}
                  followUp={fu}
                  busy={streaming}
                  onPick={pickFollowUp}
                />
              ))}
            </div>
          )}
          {pendingApprovals.length > 0 && (
            <div className="space-y-1.5">
              {pendingApprovals.map((p) => (
                <ApprovalCard
                  key={p.id}
                  approval={p}
                  base={baseEndpoint}
                  onResolved={() =>
                    setPendingApprovals((prev) =>
                      prev.filter((x) => x.id !== p.id)
                    )
                  }
                />
              ))}
            </div>
          )}
          {notices.map((n) => (
            <div
              key={n.id}
              className="rounded-md border border-border/40 bg-card/55 px-2.5 py-1.5 text-[11px] text-muted-foreground"
            >
              {n.message}
            </div>
          ))}
          {error && (
            <div className="rounded border border-destructive/40 bg-destructive/15 px-2.5 py-1.5 text-[11px] text-destructive">
              {error}
            </div>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
      {undoables.length > 0 && (
        <div className="space-y-1.5">
          {undoables.map((u) => (
            <UndoStrip
              key={u.token}
              action={u}
              onUndone={() => dropUndoable(u.token, true)}
              onExpired={() => dropUndoable(u.token, false)}
            />
          ))}
        </div>
      )}
      {activeMode === "plan" && (
        <div className="rounded-md border border-border/40 bg-card/55 px-2.5 py-1.5 text-[11px] text-muted-foreground">
          Plan mode. Mashi will not write or send. Switch to Act to execute.
        </div>
      )}
      <AgentComposer
        disabled={streaming}
        onSend={send}
        onStop={stop}
        mode={activeMode}
      />
    </div>
  );
}

/**
 * Persisted (server-confirmed) message row. Branches on role:
 *   - user → user-bubble Message
 *   - assistant with tool_calls → Reasoning (narration) + Tool cards
 *   - assistant without tool_calls → assistant Message (final answer)
 *   - tool → suppressed (renders inline under its assistant turn via
 *           the resultByCallId lookup; doesn't get its own row)
 */
function PersistedMessageRow({
  message,
  resultByCallId,
  streaming,
  onEditUser,
}: {
  message: AgentMessageRow;
  resultByCallId: Map<
    string,
    { tool_use_id: string; content: string; is_error: boolean }
  >;
  /** True while a turn is streaming — disables the edit affordance. */
  streaming?: boolean;
  /** D3: edit a prior user message and re-run from there. */
  onEditUser?: (messageId: string, content: string) => void;
}) {
  if (message.role === "user") {
    const atts = Array.isArray(message.attachments) ? message.attachments : [];
    const refs = Array.isArray(message.pinned_references)
      ? message.pinned_references
      : [];
    // D3: every prior user turn is editable. Editing re-runs the
    // conversation from that message (the server truncates after it).
    const body =
      onEditUser && message.content ? (
        <EditableUserMessage
          content={message.content}
          disabled={!!streaming}
          onResend={(next) => onEditUser(message.id, next)}
        />
      ) : message.content ? (
        <Message from="user">
          <MessageContent>
            <p className="whitespace-pre-wrap text-sm">{message.content}</p>
          </MessageContent>
        </Message>
      ) : null;
    if (atts.length === 0 && refs.length === 0) return body;
    // B1/B2: render reference + attachment chips above the (optional) body.
    return (
      <div className="space-y-1.5">
        {refs.length > 0 && (
          <ReferenceChipList references={refs} className="justify-end" />
        )}
        {atts.length > 0 && <StoredAttachmentList attachments={atts} />}
        {body}
      </div>
    );
  }
  if (message.role === "assistant") {
    const hasToolCalls =
      Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
    // C1: provenance for this turn, derived from the read tools it called and
    // their (non-error) results. Computed per-row from props already in hand —
    // no cross-message memo in the parent (which tipped the React Compiler).
    const sources = hasToolCalls
      ? dedupeSources(
          message.tool_calls!.flatMap((tc) => {
            const r = resultByCallId.get(tc.id);
            return r && !r.is_error
              ? deriveSources(tc.name, parseToolResult(r.content))
              : [];
          })
        )
      : [];
    return (
      <div className="space-y-2">
        {message.content && hasToolCalls && (
          <Reasoning isStreaming={false} defaultOpen={false}>
            <ReasoningTrigger />
            <ReasoningContent>{message.content}</ReasoningContent>
          </Reasoning>
        )}
        {hasToolCalls && (
          <div className="space-y-1.5">
            {message.tool_calls!.map((tc) => {
              const result = resultByCallId.get(tc.id);
              const parsedOutput = result ? parseToolResult(result.content) : null;
              // E3: a user-cancelled / expired ring-3 call reads as a neutral
              // "Cancelled", not an alarming red error (the model still saw
              // is_error=true so it knows the action didn't run).
              const cancelled =
                isCancelledResult(parsedOutput) ||
                isExpiredResult(parsedOutput);
              const state: ToolPartState = result
                ? cancelled
                  ? "output-cancelled"
                  : result.is_error
                    ? "output-error"
                    : "output-available"
                : "input-available";
              return (
                <Tool key={tc.id} defaultOpen={false}>
                  <ToolHeader toolName={tc.name} state={state} />
                  <ToolContent>
                    <ToolInput input={tc.input} />
                    {result && !cancelled && (
                      <ToolOutput
                        output={parsedOutput}
                        errorText={result.is_error ? result.content : null}
                        toolName={tc.name}
                      />
                    )}
                  </ToolContent>
                </Tool>
              );
            })}
          </div>
        )}
        {sources.length > 0 && <MessageSources sources={sources} />}
        {message.content && !hasToolCalls && (
          <Message from="assistant">
            <MessageContent>
              <MessageResponse>{message.content}</MessageResponse>
              {/* C3: copy the answer. Fades in on hover / keyboard focus so a
                  settled answer reads clean. */}
              <div className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                <CopyButton text={message.content} label="Copy answer" />
              </div>
            </MessageContent>
          </Message>
        )}
        <MessageMetadataNote metadata={message.metadata} />
      </div>
    );
  }
  // role === "tool" → handled by sibling assistant via resultByCallId
  return null;
}

/**
 * Renders the P1 per-message annotation (A8 error, A3 cancelled, A9
 * truncated, A6 budget) below a persisted assistant turn. Null for a
 * healthy message. The partial text the user saw is already rendered
 * above; this is just the non-destructive footnote about why the turn
 * ended the way it did.
 */
function MessageMetadataNote({
  metadata,
}: {
  metadata: AgentMessageRow["metadata"];
}) {
  if (!metadata) return null;
  if (metadata.error) {
    return (
      <div className="rounded border border-destructive/40 bg-destructive/15 px-2.5 py-1.5 text-[11px] text-destructive">
        {metadata.retryable
          ? "Connection dropped before Mashi finished. Send again to retry."
          : `Mashi hit an error: ${metadata.error}`}
      </div>
    );
  }
  // budget_exhausted messages carry the full explanation in their content
  // already, so they don't get a redundant footnote here.
  const note = metadata.cancelled
    ? "Stopped."
    : metadata.truncated
      ? "Cut off at the length limit. Ask Mashi to continue."
      : null;
  if (!note) return null;
  return (
    <div className="rounded-md border border-border/40 bg-card/55 px-2.5 py-1.5 text-[11px] text-muted-foreground">
      {note}
    </div>
  );
}

/**
 * Live (streaming) turn. Reflects in-flight state of the current model
 * call: pre-tool narration appears in Reasoning (streaming shimmer),
 * tool calls render with their current state, and any post-tool answer
 * lands in a prominent Message bubble.
 */
function LiveTurnRows({
  liveText,
  liveToolCalls,
}: {
  liveText: string;
  liveToolCalls: InFlightToolCall[];
}) {
  const hasToolCalls = liveToolCalls.length > 0;
  return (
    <div className="space-y-2">
      {liveText && hasToolCalls && (
        <Reasoning isStreaming defaultOpen>
          <ReasoningTrigger />
          <ReasoningContent>{liveText}</ReasoningContent>
        </Reasoning>
      )}
      {hasToolCalls && (
        <div className="space-y-1.5">
          {liveToolCalls.map((tc) => {
            // E3: neutral "Cancelled" outcome for a user-cancelled / expired
            // ring-3 call instead of a red error.
            const cancelled =
              isCancelledResult(tc.result) || isExpiredResult(tc.result);
            const state: ToolPartState =
              tc.ok === undefined
                ? "input-available"
                : cancelled
                  ? "output-cancelled"
                  : tc.ok
                    ? "output-available"
                    : "output-error";
            return (
              <Tool key={tc.id} defaultOpen={false}>
                <ToolHeader toolName={tc.name} state={state} />
                <ToolContent>
                  <ToolInput input={tc.args} />
                  {tc.ok !== undefined && !cancelled && (
                    <ToolOutput
                      output={tc.result}
                      errorText={tc.ok === false ? tc.error ?? "error" : null}
                      toolName={tc.name}
                    />
                  )}
                </ToolContent>
              </Tool>
            );
          })}
        </div>
      )}
      {liveText && !hasToolCalls && (
        <Message from="assistant">
          <MessageContent>
            <MessageResponse>{liveText}</MessageResponse>
          </MessageContent>
        </Message>
      )}
      {!liveText && !hasToolCalls && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Thinking…
        </div>
      )}
    </div>
  );
}

function parseToolResult(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return content;
  }
}

/** Collapse duplicate sources (same href, or same kind+title) across the
 * several read tools one turn may have used. */
function dedupeSources(sources: SourceDescriptor[]): SourceDescriptor[] {
  const seen = new Set<string>();
  const out: SourceDescriptor[] = [];
  for (const s of sources) {
    const key = `${s.kind}:${s.href ?? s.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}
