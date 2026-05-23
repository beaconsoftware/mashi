"use client";

// translucency-audit-ok: file — legacy callsites, migrate to sanctioned scale (/15, /40, /55, /60, /80, /95) case-by-case during component touch-ups.

import { useEffect, useRef, useState } from "react";
import {
  ExternalLink,
  Copy,
  Loader2,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  Send,
  Check,
  AlertTriangle,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { SourceIcon } from "@/components/shared/source-icon";
import type { S2DItem, SourceType } from "@/types";
import { cn } from "@/lib/utils";
import { streamPostText } from "@/lib/streaming";
import {
  renderClaudePrompt,
  type ContextResp,
  type SourceContext,
  type SourceDetails,
  type GmailMessage,
  type SlackMessage,
  type LinearIssueLite,
  type MeetingLite,
  type ActionItemLite,
} from "@/lib/s2d/claude-prompt";

/**
 * The detail-sheet "everything Mashi knows" panel.
 *
 * Three things in one component so the user can see context, copy it, and
 * chat about it without leaving the sheet:
 *   1. Per-source breakdown with deep links to Gmail/Slack/Linear/Fireflies
 *   2. "Copy as Claude prompt" — renders the full context as a Markdown
 *      prompt the user can paste into a fresh Claude conversation
 *   3. Per-item chat — multi-turn, streams Claude with this item's context
 *      baked into the system prompt
 */

// Context types live in src/lib/s2d/claude-prompt.ts so the prompt
// renderer + multiple panels share them. Imported above.

export function ItemContextPanel({ item }: { item: S2DItem }) {
  const [ctx, setCtx] = useState<ContextResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    fetch(`/api/s2d/${item.id}/context`)
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      })
      .then((data: ContextResp) => {
        if (!cancelled) {
          setCtx(data);
          setLoading(false);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setErr(e instanceof Error ? e.message : "Couldn't load context");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [item.id]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border/50 bg-card px-3 py-2 text-[12px] text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading context…
      </div>
    );
  }

  if (err) {
    return (
      <div className="flex items-start gap-2 rounded border border-destructive/30 bg-destructive/10 p-2 text-[12px] text-destructive">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <div>
          <div className="font-medium">Couldn't load context</div>
          <div className="text-muted-foreground">{err}</div>
        </div>
      </div>
    );
  }

  if (!ctx) return null;

  return (
    <div className="space-y-3">
      <ContextSources sources={ctx.sources} />
      <ContextActions item={item} ctx={ctx} />
      <ItemChat item={item} />
    </div>
  );
}

function ContextSources({ sources }: { sources: SourceContext[] }) {
  if (sources.length === 0) {
    return (
      <div className="rounded-md border border-border/40 bg-secondary/20 p-3 text-[12px] text-muted-foreground">
        No source context — this looks like a manually-created item.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-border/50 bg-card">
      <div className="flex items-center gap-2 border-b border-border/40 bg-secondary/40 px-3 py-2">
        <MessageSquare className="h-3.5 w-3.5 text-foreground/70" />
        <span className="text-[11px] font-semibold uppercase tracking-wider">
          Context · {sources.length} source{sources.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="divide-y divide-border/30">
        {sources.map((s, i) => (
          <SourceRow key={`${s.source_type}-${s.source_thread_id}-${i}`} source={s} />
        ))}
      </div>
    </div>
  );
}

function SourceRow({ source }: { source: SourceContext }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded} className="px-3 py-2">
      <div className="flex w-full items-center gap-2">
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            className="flex h-auto flex-1 items-center justify-start gap-2 whitespace-normal rounded-none px-0 py-0 text-left font-normal hover:bg-transparent"
          >
            {expanded ? (
              <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
            )}
            <SourceIcon type={source.source_type as SourceType} withLabel />
            <span className="text-[11px] text-muted-foreground truncate">
              {source.source_label ?? source.source_thread_id}
            </span>
          </Button>
        </CollapsibleTrigger>
        {source.deep_link && (
          <a
            href={source.deep_link}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            title="Open in source"
          >
            <ExternalLink className="h-3 w-3" />
            Open
          </a>
        )}
      </div>

      {source.snippet && !expanded && (
        <div className="mt-1 pl-5 text-[12px] text-foreground/70 line-clamp-2">
          {source.snippet}
        </div>
      )}

      <CollapsibleContent>
        <SourceDetail details={source.details} />
      </CollapsibleContent>
    </Collapsible>
  );
}

function SourceDetail({ details }: { details: SourceDetails }) {
  if (details.kind === "gmail") {
    return (
      <div className="mt-2 space-y-2 pl-5">
        {details.messages.length === 0 ? (
          <div className="text-[11px] text-muted-foreground">No messages cached.</div>
        ) : (
          details.messages.map((m, i) => (
            <div key={i} className="rounded border border-border/30 bg-secondary/30 p-2 text-[12px]">
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span className="font-medium text-foreground/80">{m.from ?? "?"}</span>
                <span>{m.at ? new Date(m.at).toLocaleString() : ""}</span>
              </div>
              {m.subject && (
                <div className="mt-0.5 text-[11px] font-medium text-foreground/80">
                  {m.subject}
                </div>
              )}
              <div className="mt-1 whitespace-pre-wrap text-foreground/75 leading-snug">
                {(m.body ?? "").slice(0, 800)}
                {(m.body ?? "").length > 800 && "…"}
              </div>
            </div>
          ))
        )}
      </div>
    );
  }

  if (details.kind === "slack") {
    return (
      <div className="mt-2 space-y-1.5 pl-5">
        {details.messages.length === 0 ? (
          <div className="text-[11px] text-muted-foreground">No messages cached.</div>
        ) : (
          details.messages.map((m, i) => (
            <div key={i} className="text-[12px]">
              <span className="text-[10px] text-muted-foreground">
                [{m.at ? new Date(m.at).toLocaleString() : "?"}]{" "}
                {m.channel ? `#${m.channel} ` : ""}
              </span>
              <span className="font-medium text-foreground/80">{m.from ?? "?"}: </span>
              <span className="text-foreground/75">{m.body}</span>
            </div>
          ))
        )}
      </div>
    );
  }

  if (details.kind === "linear") {
    const issue = details.issue;
    if (!issue) return <div className="mt-2 pl-5 text-[11px] text-muted-foreground">Not cached.</div>;
    return (
      <div className="mt-2 space-y-1 pl-5 text-[12px]">
        <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
          <span>
            status:{" "}
            <span className="font-medium text-foreground/80">{issue.status ?? "—"}</span>
          </span>
          <span>
            assignee:{" "}
            <span className="font-medium text-foreground/80">{issue.assignee_name ?? "—"}</span>
          </span>
        </div>
        {issue.description && (
          <div className="whitespace-pre-wrap text-foreground/75 leading-snug">
            {issue.description.slice(0, 1200)}
            {issue.description.length > 1200 && "…"}
          </div>
        )}
      </div>
    );
  }

  if (details.kind === "fireflies") {
    const m = details.meeting;
    return (
      <div className="mt-2 space-y-2 pl-5 text-[12px]">
        {m && (
          <div className="text-[11px] text-muted-foreground">
            {m.title} · {m.date ? new Date(m.date).toLocaleString() : ""}
          </div>
        )}
        {m?.summary && (
          <div className="whitespace-pre-wrap text-foreground/75 leading-snug">
            {m.summary.slice(0, 1200)}
            {m.summary.length > 1200 && "…"}
          </div>
        )}
        {details.action_items.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Action items
            </div>
            <ul className="mt-1 space-y-0.5">
              {details.action_items.map((a, i) => (
                <li key={i} className="text-[12px] text-foreground/80">
                  · {a.description}
                  {a.assignee && (
                    <span className="text-muted-foreground"> ({a.assignee})</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  if (details.kind === "calendar") {
    const ev = details.event;
    return (
      <div className="mt-2 pl-5 text-[12px] text-foreground/75">
        {ev?.title ?? "(no title)"}
        {ev?.at && (
          <span className="text-muted-foreground"> · {new Date(ev.at).toLocaleString()}</span>
        )}
      </div>
    );
  }

  return null;
}

function ContextActions({ item, ctx }: { item: S2DItem; ctx: ContextResp }) {
  const [copied, setCopied] = useState(false);

  async function copyAsPrompt() {
    const text = renderClaudePrompt(item, ctx);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" onClick={copyAsPrompt} className="gap-1.5">
        {copied ? (
          <Check className="h-3.5 w-3.5" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
        {copied ? "Copied" : "Copy as Claude prompt"}
      </Button>
    </div>
  );
}

// renderClaudePrompt() moved to src/lib/s2d/claude-prompt.ts so HeadsDownAction
// and other panels can reuse it. Import is at the top of this file.

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

function ItemChat({ item }: { item: S2DItem }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  async function send() {
    const text = draft.trim();
    if (!text || streaming) return;
    setDraft("");
    const next: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages([...next, { role: "assistant", content: "" }]);

    setStreaming(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let accumulated = "";
    try {
      await streamPostText(
        `/api/s2d/${item.id}/chat`,
        { messages: next },
        (delta) => {
          accumulated += delta;
          setMessages((prev) => {
            const copy = prev.slice();
            copy[copy.length - 1] = { role: "assistant", content: accumulated };
            return copy;
          });
        },
        ctrl.signal
      );
    } catch (err) {
      if (ctrl.signal.aborted) return;
      setMessages((prev) => {
        const copy = prev.slice();
        copy[copy.length - 1] = {
          role: "assistant",
          content: `_Error: ${err instanceof Error ? err.message : "stream failed"}_`,
        };
        return copy;
      });
    } finally {
      setStreaming(false);
    }
  }

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="overflow-hidden rounded-md border border-border/50 bg-card"
    >
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="flex h-auto w-full items-center justify-between rounded-none border-b border-border/40 bg-secondary/40 px-3 py-2 text-left font-normal hover:bg-secondary/40"
        >
          <div className="flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            <span className="text-[11px] font-semibold uppercase tracking-wider">
              Ask Mashi about this
            </span>
          </div>
          {open ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </Button>
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="space-y-2 p-3">
          {messages.length > 0 && (
            <div
              ref={scrollRef}
              className="max-h-72 space-y-2 overflow-y-auto rounded border border-border/30 bg-secondary/20 p-2"
            >
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={cn(
                    "rounded px-2 py-1.5 text-[12px] leading-relaxed",
                    m.role === "user"
                      ? "bg-primary/10 text-foreground"
                      : "bg-card text-foreground/90"
                  )}
                >
                  <div className="mb-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                    {m.role === "user" ? "You" : "Mashi"}
                  </div>
                  <div className="whitespace-pre-wrap">
                    {m.content}
                    {streaming &&
                      m.role === "assistant" &&
                      i === messages.length - 1 && (
                        <span className="ml-0.5 inline-block h-3 w-1.5 translate-y-0.5 bg-primary/80 animate-pulse" />
                      )}
                  </div>
                </div>
              ))}
            </div>
          )}
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void send();
              }
            }}
            rows={2}
            placeholder="Ask anything about this work… (⌘/Ctrl + Enter to send)"
            className="text-[12px]"
          />
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={send} disabled={!draft.trim() || streaming} className="gap-1.5">
              {streaming ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              {streaming ? "Streaming…" : "Send"}
            </Button>
            {messages.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setMessages([])}
                disabled={streaming}
                className="text-muted-foreground"
              >
                Clear
              </Button>
            )}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
