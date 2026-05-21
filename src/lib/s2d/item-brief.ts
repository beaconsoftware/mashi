/**
 * ItemBrief — the consolidated substrate every per-item action agent reads.
 *
 * Layer 1 of the action toolkit. Produced once per S2D item per sprint by
 * the brief consolidator (POST/GET /api/s2d/:id/brief), cached in TanStack
 * Query for the sprint's duration, then handed to every Layer 2 ActionAgent
 * as the input it reasons over.
 *
 * Shape rules:
 * - Every field is optional except the meta block — the consolidator may
 *   not have signal for, say, "outstanding questions" on a freshly-arrived
 *   item, and Layer 2 agents need to render around missing fields gracefully.
 * - Strings stay short. The brief is a SYNTHESIS, not a re-dump of source
 *   content; Layer 2 agents will read the brief AND the raw context for any
 *   detail they need.
 * - No em-dashes or en-dashes (matches the global AI-tell guardrail).
 */

import type { ContextResp } from "./claude-prompt";

export type Temperature = "escalating" | "steady" | "cooled_off" | "unknown";

export interface BriefPerson {
  /** Display name or email if name unknown. */
  name: string;
  /** Their role in this work unit, in Sidd's words ("CEO of Portco X", "AE on the deal"). */
  role?: string | null;
  /** ISO timestamp of the most recent inbound/outbound between Sidd and this person. */
  last_touch_at?: string | null;
  /** "inbound" if they were waiting on Sidd, "outbound" if Sidd was waiting on them. */
  last_touch_direction?: "inbound" | "outbound" | "unknown" | null;
}

export interface BriefTimelineEvent {
  /** ISO timestamp. */
  at: string;
  /** "gmail" / "slack" / "linear" / "fireflies" / "calendar" / "internal". */
  source: string;
  /** One-line description of what happened. */
  summary: string;
}

export interface ItemBrief {
  /** Always present. Used to detect stale briefs in the cache. */
  meta: {
    item_id: string;
    /** ISO timestamp the brief was synthesized. */
    generated_at: string;
    /** Model identifier the synthesis used. */
    model: string;
    /** Number of source bundles the consolidator looked at. */
    sources_considered: number;
  };

  /** One-sentence summary of the work unit and where it stands. */
  headline?: string | null;

  /** Key people involved + when Sidd last touched them. */
  key_people?: BriefPerson[];

  /** Chronological activity across all sources. Newest last. */
  timeline?: BriefTimelineEvent[];

  /** Questions explicitly raised by someone else and not yet answered by Sidd. */
  outstanding_questions?: string[];

  /** Statements Sidd has made on the record. Short quotes / paraphrases. */
  what_sidd_has_said?: string[];

  /** Promises Sidd made that haven't been fulfilled. */
  open_commitments?: string[];

  /** What Sidd has NOT yet said that the other side may be expecting. */
  what_sidd_has_not_said?: string[];

  /** escalating / steady / cooled_off — is the situation heating up? */
  temperature?: Temperature;

  /** Recommended next move in one sentence. Acts as the "default action" for the toolkit. */
  recommended_next_move?: string | null;

  /** Names from the buying / delegate / stakeholder unit, useful for socialize / cc actions. */
  stakeholders_to_consider?: string[];
}

/**
 * Render the brief as Markdown for injection into a Layer 2 action prompt.
 * Stays compact — agents need substrate, not a wall of text.
 */
export function renderBriefForPrompt(brief: ItemBrief): string {
  const lines: string[] = [];
  if (brief.headline) {
    lines.push(`Headline: ${brief.headline}`);
  }
  if (brief.temperature && brief.temperature !== "unknown") {
    lines.push(`Temperature: ${brief.temperature}`);
  }
  if (brief.recommended_next_move) {
    lines.push(`Recommended next: ${brief.recommended_next_move}`);
  }
  if (brief.key_people?.length) {
    lines.push("");
    lines.push("Key people:");
    for (const p of brief.key_people) {
      const role = p.role ? ` (${p.role})` : "";
      const touch = p.last_touch_at
        ? ` last touch ${p.last_touch_at.slice(0, 10)} ${p.last_touch_direction ?? ""}`.trim()
        : "";
      lines.push(`- ${p.name}${role}${touch}`);
    }
  }
  if (brief.outstanding_questions?.length) {
    lines.push("");
    lines.push("Outstanding questions to Sidd:");
    for (const q of brief.outstanding_questions) {
      lines.push(`- ${q}`);
    }
  }
  if (brief.what_sidd_has_said?.length) {
    lines.push("");
    lines.push("What Sidd has said:");
    for (const s of brief.what_sidd_has_said) {
      lines.push(`- ${s}`);
    }
  }
  if (brief.what_sidd_has_not_said?.length) {
    lines.push("");
    lines.push("What Sidd has not yet said:");
    for (const s of brief.what_sidd_has_not_said) {
      lines.push(`- ${s}`);
    }
  }
  if (brief.open_commitments?.length) {
    lines.push("");
    lines.push("Open commitments by Sidd:");
    for (const c of brief.open_commitments) {
      lines.push(`- ${c}`);
    }
  }
  if (brief.timeline?.length) {
    lines.push("");
    lines.push("Timeline (oldest first):");
    for (const t of brief.timeline) {
      lines.push(`- [${t.at.slice(0, 16)}] (${t.source}) ${t.summary}`);
    }
  }
  if (brief.stakeholders_to_consider?.length) {
    lines.push("");
    lines.push(`Stakeholders: ${brief.stakeholders_to_consider.join(", ")}`);
  }
  return lines.join("\n");
}

/**
 * Compact a ContextResp into a string the consolidator LLM can read.
 * Distinct from the heavy renderClaudePrompt() — keeps things short so the
 * synthesis call stays cheap.
 */
export function renderContextForBrief(ctx: ContextResp): string {
  const lines: string[] = [];
  for (const s of ctx.sources) {
    lines.push(`--- ${s.source_type.toUpperCase()} (${s.source_label ?? s.source_thread_id})`);
    if (s.details.kind === "gmail") {
      for (const m of s.details.messages) {
        const at = m.at ? m.at.slice(0, 16) : "";
        lines.push(`[${at}] FROM ${m.from ?? "?"}: ${m.subject ?? ""}`);
        const body = (m.body ?? "").slice(0, 500).replace(/\s+/g, " ");
        if (body) lines.push(body);
      }
    } else if (s.details.kind === "slack") {
      for (const m of s.details.messages) {
        const at = m.at ? m.at.slice(0, 16) : "";
        lines.push(
          `[${at}] #${m.channel ?? "?"} ${m.from ?? "?"}: ${(m.body ?? "").slice(0, 300)}`
        );
      }
    } else if (s.details.kind === "linear" && s.details.issue) {
      const i = s.details.issue;
      lines.push(`title: ${i.title ?? ""}`);
      lines.push(`status: ${i.status ?? ""} / assignee: ${i.assignee_name ?? "—"}`);
      if (i.description) lines.push(i.description.slice(0, 800).replace(/\s+/g, " "));
    } else if (s.details.kind === "fireflies" && s.details.meeting) {
      const m = s.details.meeting;
      lines.push(`title: ${m.title ?? ""} / date: ${m.date ?? ""}`);
      if (m.summary) lines.push(m.summary.slice(0, 800).replace(/\s+/g, " "));
      if (s.details.action_items.length > 0) {
        lines.push("action items:");
        for (const a of s.details.action_items) {
          lines.push(`- ${a.description}${a.assignee ? ` (${a.assignee})` : ""}`);
        }
      }
    } else if (s.details.kind === "calendar" && s.details.event) {
      lines.push(`${s.details.event.title ?? ""} @ ${s.details.event.at ?? ""}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * Empty/skeleton brief returned when the item has no source context to
 * synthesize from. Layer 2 actions can still render their UI; they'll
 * just lean on item.title / item.description.
 */
export function emptyBrief(itemId: string, model: string): ItemBrief {
  return {
    meta: {
      item_id: itemId,
      generated_at: new Date().toISOString(),
      model,
      sources_considered: 0,
    },
    headline: null,
    key_people: [],
    timeline: [],
    outstanding_questions: [],
    what_sidd_has_said: [],
    what_sidd_has_not_said: [],
    open_commitments: [],
    temperature: "unknown",
    recommended_next_move: null,
    stakeholders_to_consider: [],
  };
}
