/**
 * Build a Claude-ready prompt for a single S2D item, including all the
 * source-side context Mashi has cached (Gmail thread, Slack day-slice,
 * Linear issue, Fireflies meeting, etc.).
 *
 * Used by the "Copy Claude prompt" buttons in the item sheet — the
 * resulting markdown drops cleanly into a fresh Claude / Claude Code
 * conversation with everything the model needs.
 *
 * Lives in its own file (not the component) so multiple action panels
 * can share it without circular imports.
 */
import type { S2DItem } from "@/types";

export interface ContextResp {
  item: S2DItem;
  sources: SourceContext[];
}

export interface SourceContext {
  source_type: string;
  source_thread_id: string;
  source_label: string | null;
  deep_link: string | null;
  snippet: string | null;
  details: SourceDetails;
}

export type SourceDetails =
  | { kind: "gmail"; messages: GmailMessage[] }
  | { kind: "slack"; messages: SlackMessage[] }
  | { kind: "linear"; issue: LinearIssueLite | null }
  | { kind: "fireflies"; meeting: MeetingLite | null; action_items: ActionItemLite[] }
  | { kind: "calendar"; event: { title: string | null; at: string | null } | null }
  | { kind: "other" };

export interface GmailMessage {
  from: string | null;
  at: string | null;
  subject: string | null;
  body: string | null;
}
export interface SlackMessage {
  channel: string | null;
  from: string | null;
  at: string | null;
  body: string | null;
}
export interface LinearIssueLite {
  title: string | null;
  status: string | null;
  url: string | null;
  description: string | null;
  assignee_name: string | null;
}
export interface MeetingLite {
  title: string | null;
  date: string | null;
  summary: string | null;
  attendees: unknown;
}
export interface ActionItemLite {
  description: string;
  assignee: string | null;
  status: string | null;
}

/**
 * Render the prompt as Markdown. Pass either a fully-loaded ContextResp
 * (when you've hit /api/s2d/[id]/context) or just the item alone
 * (caller wants a lighter prompt without source hydration).
 */
export function renderClaudePrompt(
  item: S2DItem,
  ctx: ContextResp | null
): string {
  const lines: string[] = [];
  lines.push(`# Context: MASH-${item.ticket_number ?? "?"} — ${item.title}`);
  lines.push("");
  if (item.description) {
    lines.push(item.description);
    lines.push("");
  }
  lines.push(
    `pathway: ${item.pathway} · priority: ${item.priority} · status: ${item.status}`
  );
  if (item.queue_reason) lines.push(`queue: ${item.queue_reason}`);
  if (item.delegated_to) lines.push(`delegated to: ${item.delegated_to}`);
  lines.push("");

  const sources = ctx?.sources ?? [];
  if (sources.length === 0) {
    lines.push("_No source context loaded — manually-created item or context unavailable._");
  }

  for (const s of sources) {
    lines.push(`---`);
    lines.push(
      `## ${s.source_type.toUpperCase()} — ${s.source_label ?? s.source_thread_id}`
    );
    if (s.deep_link) lines.push(`Link: ${s.deep_link}`);
    lines.push("");
    if (s.details.kind === "gmail") {
      for (const m of s.details.messages) {
        lines.push(
          `**${m.from ?? "?"}** _${m.at ? new Date(m.at).toLocaleString() : ""}_`
        );
        if (m.subject) lines.push(`Subject: ${m.subject}`);
        lines.push("");
        lines.push((m.body ?? "").slice(0, 1500));
        lines.push("");
      }
    } else if (s.details.kind === "slack") {
      for (const m of s.details.messages) {
        lines.push(
          `[${m.at ? new Date(m.at).toLocaleString() : "?"}] #${m.channel ?? "?"} **${m.from ?? "?"}**: ${m.body ?? ""}`
        );
      }
      lines.push("");
    } else if (s.details.kind === "linear" && s.details.issue) {
      const i = s.details.issue;
      lines.push(`Title: ${i.title ?? ""}`);
      lines.push(`Status: ${i.status ?? "—"}  ·  Assignee: ${i.assignee_name ?? "—"}`);
      lines.push("");
      if (i.description) lines.push(i.description.slice(0, 2000));
      lines.push("");
    } else if (s.details.kind === "fireflies" && s.details.meeting) {
      const m = s.details.meeting;
      lines.push(
        `${m.title ?? ""} · ${m.date ? new Date(m.date).toLocaleString() : ""}`
      );
      lines.push("");
      if (m.summary) lines.push(m.summary.slice(0, 2000));
      lines.push("");
      if (s.details.action_items.length > 0) {
        lines.push(`**Action items:**`);
        for (const a of s.details.action_items) {
          lines.push(`- ${a.description}${a.assignee ? ` _(${a.assignee})_` : ""}`);
        }
        lines.push("");
      }
    } else if (s.details.kind === "calendar" && s.details.event) {
      lines.push(
        `${s.details.event.title ?? ""} · ${s.details.event.at ? new Date(s.details.event.at).toLocaleString() : ""}`
      );
      lines.push("");
    }
  }

  lines.push(`---`);
  lines.push(`**Question for you:** [replace this with what you want Claude to help with]`);
  return lines.join("\n");
}

/**
 * Fetch the context bundle and render — convenience wrapper for callers
 * that don't already have a ContextResp in hand.
 */
export async function fetchAndRenderClaudePrompt(
  item: S2DItem
): Promise<string> {
  try {
    const r = await fetch(`/api/s2d/${item.id}/context`);
    if (!r.ok) {
      // Fall back to the no-source prompt — better than nothing.
      return renderClaudePrompt(item, null);
    }
    const ctx = (await r.json()) as ContextResp;
    return renderClaudePrompt(item, ctx);
  } catch {
    return renderClaudePrompt(item, null);
  }
}
