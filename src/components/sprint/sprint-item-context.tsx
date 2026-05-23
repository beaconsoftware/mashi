"use client";

// translucency-audit-ok: file — legacy callsites, migrate to sanctioned scale (/15, /40, /55, /60, /80, /95) case-by-case during component touch-ups.

/**
 * Per-slot source context for sprint active mode.
 *
 * Surfaces every linked source (gmail / slack / linear / fireflies /
 * calendar) for the current S2D item, with deep links and a 1-line
 * preview. Pathway-aware: pinned signal at the top is the thing the
 * user most likely needs to see to act:
 *
 *   drafted_response / quick_reply  -> latest inbound message + sender
 *   delegated / watching            -> last update from delegatee + age
 *   meeting_backed                  -> next meeting time + attendees
 *   heads_down                      -> source description / Fireflies summary
 *   decision_gate                   -> most recent thread snippet
 *
 * Fetches via TanStack Query through useS2DItemContext, so sources stay
 * cached across slot moves and the slot doesn't block on the API call.
 * Lives BELOW the action-oriented SprintContextPackage — the user gets
 * the call-to-action first, then can drop into source detail if they
 * need more.
 */

import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Loader2,
  Sparkles,
  MessageSquare,
  Mail,
  Hash,
  GitBranch,
  Mic,
  Calendar,
} from "lucide-react";
import { useS2DItemContext } from "@/hooks/use-s2d";
import type {
  ContextResp,
  SourceContext,
  SourceDetails,
} from "@/lib/s2d/claude-prompt";
import type { Pathway, S2DItem } from "@/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

interface Props {
  item: S2DItem;
  /**
   * When true, fetch eagerly. Sprint slot passes true; bench preview
   * popovers pass true only while hovered.
   */
  enabled: boolean;
}

export function SprintItemContext({ item, enabled }: Props) {
  const ctx = useS2DItemContext(item.id, enabled);

  if (!enabled) return null;

  if (ctx.isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border/30 bg-card/40 px-2.5 py-2 text-[11px] text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Loading source context...
      </div>
    );
  }

  if (ctx.isError || !ctx.data) {
    return null;
  }

  const sources = ctx.data.sources;
  if (sources.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2 rounded-md border border-border/40 bg-card/50 p-2.5">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Sparkles className="h-3 w-3 text-primary" />
        Source context
        <span className="font-mono text-[9px] opacity-60">
          {sources.length} {sources.length === 1 ? "source" : "sources"}
        </span>
      </div>

      <PinnedSignal item={item} ctx={ctx.data} />

      <ul className="space-y-1">
        {sources.map((s, i) => (
          <SourceRow key={`${s.source_type}-${s.source_thread_id}-${i}`} source={s} />
        ))}
      </ul>
    </div>
  );
}

/**
 * The "if you only read one thing" snippet. Picked per pathway from the
 * most relevant source. Surfaces directly above the chip list so the
 * user can stay heads-down without clicking through.
 */
function PinnedSignal({ item, ctx }: { item: S2DItem; ctx: ContextResp }) {
  const signal = pickPinnedSignal(item.pathway, ctx.sources);
  if (!signal) return null;

  return (
    <div className="rounded border border-primary/25 bg-primary/5 p-2">
      <div className="flex items-start gap-2">
        <SourceTypeIcon type={signal.source_type} className="mt-0.5 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-primary">
            {signal.label}
            {signal.when && (
              <span className="font-mono normal-case text-muted-foreground">
                · {signal.when}
              </span>
            )}
          </div>
          <div className="mt-0.5 line-clamp-3 text-[12px] leading-snug text-foreground/85">
            {signal.body}
          </div>
        </div>
        {signal.deep_link && (
          <a
            href={signal.deep_link}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            title="Open source"
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </div>
  );
}

/**
 * Per pathway, decide which source carries the "most actionable" signal
 * and extract a 1-line surface for it. Returns null when nothing useful
 * is available (e.g. only stale meeting metadata) so we hide the box.
 */
function pickPinnedSignal(
  pathway: Pathway,
  sources: SourceContext[]
): {
  source_type: string;
  label: string;
  body: string;
  when: string | null;
  deep_link: string | null;
} | null {
  // For reply pathways, the latest INBOUND gmail or slack message is what
  // the user is replying to. Find the latest message from someone other
  // than the user.
  if (pathway === "quick_reply" || pathway === "drafted_response") {
    for (const s of sources) {
      if (s.details.kind === "gmail") {
        const last = s.details.messages[s.details.messages.length - 1];
        if (!last?.body) continue;
        return {
          source_type: s.source_type,
          label: `Latest from ${last.from ?? "sender"}`,
          body: last.body.slice(0, 280),
          when: formatRelative(last.at),
          deep_link: s.deep_link,
        };
      }
      if (s.details.kind === "slack") {
        const last = s.details.messages[s.details.messages.length - 1];
        if (!last?.body) continue;
        return {
          source_type: s.source_type,
          label: `Latest from ${last.from ?? "sender"}`,
          body: last.body.slice(0, 280),
          when: formatRelative(last.at),
          deep_link: s.deep_link,
        };
      }
    }
  }

  // Tracking pathways: lead with whatever the assignee said most recently.
  if (pathway === "delegated" || pathway === "watching") {
    for (const s of sources) {
      if (s.details.kind === "linear" && s.details.issue) {
        const issue = s.details.issue;
        return {
          source_type: s.source_type,
          label: `Linear · ${issue.status ?? "open"}`,
          body:
            issue.description?.slice(0, 280) ??
            issue.title ??
            "(no description)",
          when: issue.assignee_name ? `assigned to ${issue.assignee_name}` : null,
          deep_link: s.deep_link,
        };
      }
      if (s.details.kind === "gmail") {
        const last = s.details.messages[s.details.messages.length - 1];
        if (!last?.body) continue;
        return {
          source_type: s.source_type,
          label: `Last update · ${last.from ?? "sender"}`,
          body: last.body.slice(0, 280),
          when: formatRelative(last.at),
          deep_link: s.deep_link,
        };
      }
    }
  }

  // Heads-down: any rich source description is gold orientation material.
  if (pathway === "heads_down") {
    for (const s of sources) {
      if (s.details.kind === "fireflies" && s.details.meeting?.summary) {
        return {
          source_type: s.source_type,
          label: "Meeting summary",
          body: s.details.meeting.summary.slice(0, 280),
          when: formatRelative(s.details.meeting.date),
          deep_link: s.deep_link,
        };
      }
      if (s.details.kind === "linear" && s.details.issue?.description) {
        return {
          source_type: s.source_type,
          label: `Linear · ${s.details.issue.status ?? "open"}`,
          body: s.details.issue.description.slice(0, 280),
          when: null,
          deep_link: s.deep_link,
        };
      }
    }
  }

  // Meeting-backed: surface the meeting time as the pin (user mostly
  // needs "when is this happening" + the deep link).
  if (pathway === "meeting_backed") {
    for (const s of sources) {
      if (s.details.kind === "calendar" && s.details.event) {
        return {
          source_type: s.source_type,
          label: "Upcoming meeting",
          body: s.details.event.title ?? "(no title)",
          when: formatAbsolute(s.details.event.at),
          deep_link: s.deep_link,
        };
      }
      if (s.details.kind === "fireflies" && s.details.meeting) {
        return {
          source_type: s.source_type,
          label: "Past meeting",
          body: s.details.meeting.summary?.slice(0, 280) ?? s.details.meeting.title ?? "",
          when: formatRelative(s.details.meeting.date),
          deep_link: s.deep_link,
        };
      }
    }
  }

  // Generic fallback: first source with a snippet wins.
  for (const s of sources) {
    if (s.snippet) {
      return {
        source_type: s.source_type,
        label: s.source_label ?? s.source_type,
        body: s.snippet.slice(0, 280),
        when: null,
        deep_link: s.deep_link,
      };
    }
  }
  return null;
}

function SourceRow({ source }: { source: SourceContext }) {
  const [expanded, setExpanded] = useState(false);
  const inlineMeta = sourceInlineMeta(source);

  return (
    <li className="rounded border border-border/30 bg-background/30">
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <div className="flex w-full items-center gap-2 px-2 py-1.5">
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
              <SourceTypeIcon type={source.source_type} />
              <span className="line-clamp-1 flex-1 text-[11px] text-foreground/85">
                {inlineMeta ?? source.source_label ?? source.source_thread_id}
              </span>
            </Button>
          </CollapsibleTrigger>
          {source.deep_link && (
            <a
              href={source.deep_link}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              title="Open in source"
            >
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
        {!expanded && source.snippet && (
          <div className="line-clamp-1 px-2 pb-1.5 pl-7 text-[11px] text-muted-foreground">
            {source.snippet}
          </div>
        )}
        <CollapsibleContent>
          <div className="border-t border-border/30 px-2 py-2 pl-7">
            <SourceDetailInline details={source.details} />
          </div>
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

function sourceInlineMeta(source: SourceContext): string | null {
  const d = source.details;
  if (d.kind === "gmail" && d.messages.length > 0) {
    return `Gmail · ${d.messages.length} message${d.messages.length === 1 ? "" : "s"}`;
  }
  if (d.kind === "slack" && d.messages.length > 0) {
    return `Slack · ${d.messages.length} message${d.messages.length === 1 ? "" : "s"}`;
  }
  if (d.kind === "linear" && d.issue) {
    return `Linear · ${d.issue.status ?? "open"}`;
  }
  if (d.kind === "fireflies" && d.meeting) {
    return `Fireflies · ${d.meeting.title ?? "meeting"}`;
  }
  if (d.kind === "calendar" && d.event) {
    return `Calendar · ${d.event.title ?? "event"}`;
  }
  return source.source_label;
}

function SourceDetailInline({ details }: { details: SourceDetails }) {
  // Compact inline view — keeps the slot tight. The detail panel
  // (item-context-panel.tsx) has the full expanded read.
  if (details.kind === "gmail") {
    const last = details.messages[details.messages.length - 1];
    if (!last) return <Empty />;
    return (
      <div className="space-y-0.5 text-[11px] text-foreground/80">
        <div className="text-[10px] text-muted-foreground">
          {last.from ?? "?"} · {formatAbsolute(last.at)}
        </div>
        {last.subject && (
          <div className="font-medium">{last.subject}</div>
        )}
        <div className="whitespace-pre-wrap leading-snug">
          {(last.body ?? "").slice(0, 500)}
          {(last.body ?? "").length > 500 && "..."}
        </div>
      </div>
    );
  }
  if (details.kind === "slack") {
    const last = details.messages[details.messages.length - 1];
    if (!last) return <Empty />;
    return (
      <div className="text-[11px] text-foreground/80">
        <span className="text-[10px] text-muted-foreground">
          {last.channel ? `#${last.channel} ` : ""}
          {last.from ?? "?"} · {formatAbsolute(last.at)}
        </span>
        <div className="mt-0.5 leading-snug">{last.body}</div>
      </div>
    );
  }
  if (details.kind === "linear" && details.issue) {
    return (
      <div className="space-y-0.5 text-[11px] text-foreground/80">
        <div className="text-[10px] text-muted-foreground">
          status: {details.issue.status ?? "-"}
          {details.issue.assignee_name && (
            <> · assignee: {details.issue.assignee_name}</>
          )}
        </div>
        {details.issue.description && (
          <div className="whitespace-pre-wrap leading-snug">
            {details.issue.description.slice(0, 500)}
            {details.issue.description.length > 500 && "..."}
          </div>
        )}
      </div>
    );
  }
  if (details.kind === "fireflies" && details.meeting) {
    return (
      <div className="space-y-1 text-[11px] text-foreground/80">
        <div className="text-[10px] text-muted-foreground">
          {details.meeting.title} · {formatAbsolute(details.meeting.date)}
        </div>
        {details.meeting.summary && (
          <div className="whitespace-pre-wrap leading-snug">
            {details.meeting.summary.slice(0, 500)}
            {details.meeting.summary.length > 500 && "..."}
          </div>
        )}
        {details.action_items.length > 0 && (
          <div>
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground">
              Action items ({details.action_items.length})
            </div>
            <ul className="mt-0.5 space-y-0.5">
              {details.action_items.slice(0, 4).map((a, i) => (
                <li key={i} className="leading-snug">
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
  if (details.kind === "calendar" && details.event) {
    return (
      <div className="text-[11px] text-foreground/80">
        {details.event.title ?? "(no title)"}
        {details.event.at && (
          <span className="text-muted-foreground">
            {" "}
            · {formatAbsolute(details.event.at)}
          </span>
        )}
      </div>
    );
  }
  return <Empty />;
}

function Empty() {
  return <div className="text-[10px] text-muted-foreground">No details cached.</div>;
}

function SourceTypeIcon({ type, className }: { type: string; className?: string }) {
  const c = cn("h-3 w-3 shrink-0", className);
  if (type === "gmail") return <Mail className={c} />;
  if (type === "slack") return <Hash className={c} />;
  if (type === "linear") return <GitBranch className={c} />;
  if (type === "fireflies") return <Mic className={c} />;
  if (type === "calendar") return <Calendar className={c} />;
  return <MessageSquare className={c} />;
}

function formatRelative(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

function formatAbsolute(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
