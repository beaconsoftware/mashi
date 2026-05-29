"use client";

// translucency-audit-ok: file — legacy callsites, migrate to sanctioned scale (/15, /40, /55, /60, /80, /95) case-by-case during component touch-ups.

import { useEffect, useState } from "react";
import {
  ExternalLink,
  Copy,
  Loader2,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  Check,
  AlertTriangle,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { SourceIcon } from "@/components/shared/source-icon";
import { AskMashiButton } from "@/components/agent/ask-mashi-button";
import type { S2DItem, SourceType } from "@/types";
import { cn } from "@/lib/utils";
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
      <AskMashiCta itemId={item.id} />
    </div>
  );
}

/**
 * Promoted Ask Mashi entry point inside the item context panel.
 *
 * Replaces the legacy "Ask Mashi about this" collapsible that used the
 * dumb `/api/s2d/:id/chat` endpoint — pre-loaded source context into a
 * system prompt, NO tool access, NO MASHI.md memory, NO plan/act, NO
 * approvals, NO undo. It told users to their face it couldn't pull
 * Slack/Gmail/etc. and they believed it because it was right.
 *
 * The proper agent has all of that and is already wired up via the
 * top-right `[Ask Mashi]` chip on the item sheet. This CTA is the same
 * action with promoted visual weight + clearer copy, planted where the
 * collapsible used to live so the discovery path from the context
 * panel isn't lost.
 */
function AskMashiCta({ itemId }: { itemId: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-2.5">
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider">
          <Sparkles className="h-3 w-3 text-primary" />
          Ask Mashi about this work
        </div>
        <p className="text-[11px] text-muted-foreground">
          Full agent with tool access, memory, and approvals. Reads Slack,
          Gmail, Linear, meetings, calendar.
        </p>
      </div>
      <AskMashiButton itemId={itemId} label="Open" className="shrink-0" />
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
