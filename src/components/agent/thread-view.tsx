"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Loader2, Sparkles, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useCursorContext } from "@/lib/agent/cursor-context";
import { AgentComposer } from "@/components/agent/composer";
import { cn } from "@/lib/utils";
import type { AgentDelta } from "@/lib/agent/loop";

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
}

interface ThreadData {
  thread: { id: string; title: string; summary: string | null } | null;
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

/**
 * Renders an item's persistent agent thread plus the composer.
 *
 * Loading strategy:
 *   - On mount, `GET /api/agent/threads/[itemId]` returns existing
 *     thread+messages, or {thread:null,messages:[]} when none exists.
 *   - When the user sends, we POST to /messages and stream SSE deltas.
 *     The "live" assistant text plus in-flight tool-call rows render
 *     on top of the persisted message list; once the stream ends we
 *     invalidate the query so the next render picks up the durable
 *     rows the server wrote.
 */
export function ThreadView({ itemId }: { itemId: string }) {
  const cursor = useCursorContext();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery<ThreadData>({
    queryKey: ["agent-thread", itemId],
    queryFn: async () => {
      const res = await fetch(`/api/agent/threads/${itemId}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`thread fetch ${res.status}`);
      return res.json();
    },
    staleTime: 1_000,
  });

  const [liveText, setLiveText] = useState("");
  const [liveToolCalls, setLiveToolCalls] = useState<InFlightToolCall[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const messagesRef = useRef(data?.messages ?? []);
  messagesRef.current = data?.messages ?? [];

  // Scroll-to-bottom on new persisted turns + during streaming. The
  // ScrollArea wraps a Radix viewport; we scroll the inner viewport.
  useEffect(() => {
    const el = scrollRef.current?.querySelector(
      "[data-radix-scroll-area-viewport]"
    );
    if (el) (el as HTMLElement).scrollTop = (el as HTMLElement).scrollHeight;
  }, [data?.messages, liveText, liveToolCalls.length]);

  async function send(message: string) {
    if (!message.trim() || streaming) return;
    setStreaming(true);
    setLiveText("");
    setLiveToolCalls([]);
    setError(null);

    try {
      const res = await fetch(`/api/agent/threads/${itemId}/messages`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, cursor }),
      });
      if (!res.ok || !res.body) {
        setError(`Couldn't reach Mashi (${res.status}).`);
        setStreaming(false);
        return;
      }
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
      setError(err instanceof Error ? err.message : "stream failed");
    } finally {
      setStreaming(false);
      setLiveText("");
      setLiveToolCalls([]);
      queryClient.invalidateQueries({ queryKey: ["agent-thread", itemId] });
    }
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
      setLiveToolCalls((prev) =>
        prev.map((c) =>
          c.id === d.id
            ? { ...c, ok: d.ok, result: d.result, error: d.error }
            : c
        )
      );
    } else if (d.kind === "error") {
      setError(d.message);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <ScrollArea
        ref={scrollRef}
        className="flex-1 rounded-md border border-border/40 bg-card/55"
      >
        <div className="space-y-2 p-3">
          {data?.thread?.summary && (
            <ThreadSummary summary={data.thread.summary} />
          )}
          {isLoading && (
            <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading conversation…
            </div>
          )}
          {!isLoading && (data?.messages.length ?? 0) === 0 && !streaming && (
            <EmptyState />
          )}
          {data?.messages.map((m) => (
            <MessageRow key={m.id} message={m} />
          ))}
          {streaming && liveToolCalls.length > 0 && (
            <div className="space-y-1.5">
              {liveToolCalls.map((tc) => (
                <ToolCallRow key={tc.id} call={tc} />
              ))}
            </div>
          )}
          {streaming && (
            <LiveAssistantRow text={liveText} pending={liveText.length === 0} />
          )}
          {error && (
            <div className="rounded border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-[11px] text-destructive">
              {error}
            </div>
          )}
        </div>
      </ScrollArea>
      <AgentComposer disabled={streaming} onSend={send} />
    </div>
  );
}

function ThreadSummary({ summary }: { summary: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border border-primary/30 bg-primary/15 px-2.5 py-1.5 text-[11px]">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        className="mashi-press h-auto w-full justify-start gap-1 rounded p-0 text-[10px] font-mono uppercase tracking-wider text-primary hover:bg-transparent hover:text-primary"
      >
        <ChevronRight
          className={cn(
            "h-3 w-3 transition-transform",
            open && "rotate-90"
          )}
        />
        Prior conversation summary
      </Button>
      {open && (
        <p className="mt-1.5 whitespace-pre-wrap text-foreground/85">
          {summary}
        </p>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-md border border-dashed border-border/40 bg-card/60 p-3 text-[12px] text-muted-foreground">
      <p className="mb-1 flex items-center gap-1 font-medium text-foreground">
        <Sparkles className="h-3 w-3 text-primary" /> Ask Mashi about this
      </p>
      <p>
        Ask, decide, snooze, send. Examples, &quot;what is this about?&quot;,
        &quot;summarize the last reply&quot;, &quot;what should I do here?&quot;.
      </p>
    </div>
  );
}

function MessageRow({ message }: { message: AgentMessageRow }) {
  if (message.role === "user") {
    return (
      <div className="rounded-md border border-border/30 bg-secondary/40 px-2.5 py-1.5 text-[12px] leading-snug">
        <div className="mb-0.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">
          you
        </div>
        <p className="whitespace-pre-wrap text-foreground/90">
          {message.content}
        </p>
      </div>
    );
  }
  if (message.role === "assistant") {
    return (
      <div className="rounded-md border border-primary/30 bg-primary/15 px-2.5 py-1.5 text-[12px] leading-snug">
        <div className="mb-0.5 font-mono text-[9px] uppercase tracking-wider text-primary/80">
          mashi
        </div>
        {message.content && (
          <p className="whitespace-pre-wrap text-foreground/90">
            {message.content}
          </p>
        )}
        {Array.isArray(message.tool_calls) && message.tool_calls.length > 0 && (
          <div className="mt-1.5 space-y-1">
            {message.tool_calls.map((tc) => (
              <ToolCallRow
                key={tc.id}
                call={{ id: tc.id, name: tc.name, args: tc.input, ok: true }}
                collapsed
              />
            ))}
          </div>
        )}
      </div>
    );
  }
  if (message.role === "tool") {
    if (!Array.isArray(message.tool_results)) return null;
    return (
      <div className="space-y-1">
        {message.tool_results.map((r) => (
          <ToolResultRow key={r.tool_use_id} result={r} />
        ))}
      </div>
    );
  }
  return null;
}

function ToolCallRow({
  call,
  collapsed = false,
}: {
  call: InFlightToolCall;
  collapsed?: boolean;
}) {
  const [open, setOpen] = useState(!collapsed);
  const pending = call.ok === undefined;
  return (
    <div className="rounded border border-border/40 bg-card/80 px-2 py-1 text-[11px] text-muted-foreground">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        className="mashi-press flex h-auto w-full items-center justify-start gap-1 rounded p-0 text-[10px] font-mono uppercase tracking-wider hover:bg-transparent"
      >
        <ChevronRight
          className={cn(
            "h-3 w-3 transition-transform",
            open && "rotate-90"
          )}
        />
        <Wrench className="h-3 w-3" />
        <span className="normal-case tracking-normal">{call.name}</span>
        {pending && <Loader2 className="ml-auto h-3 w-3 animate-spin" />}
        {call.ok === true && (
          <span className="ml-auto text-emerald-400">ok</span>
        )}
        {call.ok === false && (
          <span className="ml-auto text-destructive">err</span>
        )}
      </Button>
      {open && (
        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] text-foreground/80">
          {JSON.stringify(
            { args: call.args ?? null, result: call.result, error: call.error },
            null,
            2
          )}
        </pre>
      )}
    </div>
  );
}

function ToolResultRow({
  result,
}: {
  result: { tool_use_id: string; content: string; is_error: boolean };
}) {
  const [open, setOpen] = useState(false);
  const parsed = useMemo(() => {
    try {
      return JSON.parse(result.content);
    } catch {
      return result.content;
    }
  }, [result.content]);
  return (
    <div
      className={cn(
        "rounded border bg-card/80 px-2 py-1 text-[11px]",
        result.is_error
          ? "border-destructive/40 text-destructive"
          : "border-border/40 text-muted-foreground"
      )}
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        className="mashi-press flex h-auto w-full items-center justify-start gap-1 rounded p-0 text-[10px] font-mono uppercase tracking-wider hover:bg-transparent"
      >
        <ChevronRight
          className={cn(
            "h-3 w-3 transition-transform",
            open && "rotate-90"
          )}
        />
        result
      </Button>
      {open && (
        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] text-foreground/80">
          {typeof parsed === "string"
            ? parsed
            : JSON.stringify(parsed, null, 2)}
        </pre>
      )}
    </div>
  );
}

function LiveAssistantRow({
  text,
  pending,
}: {
  text: string;
  pending: boolean;
}) {
  return (
    <div className="rounded-md border border-primary/30 bg-primary/15 px-2.5 py-1.5 text-[12px] leading-snug">
      <div className="mb-0.5 flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider text-primary/80">
        mashi
        {pending && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
      </div>
      <p className="whitespace-pre-wrap text-foreground/90">{text}</p>
    </div>
  );
}
