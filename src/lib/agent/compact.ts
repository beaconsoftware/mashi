import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { trackedCreate } from "@/lib/anthropic/tracked";
import { MODELS } from "@/lib/anthropic/client";
import { sanitizeForAITells } from "@/lib/anthropic/sanitize";
import { loadThread, type AgentMessageRow } from "@/lib/agent/threads";

/**
 * Thread compaction (Phase 6).
 *
 * When a thread accumulates too much message content for a healthy
 * prompt budget, summarize all-but-the-last-N turns into the thread's
 * `summary` column and stamp the absorbed message rows with
 * `superseded_by_summary_at`. The agent loop ignores superseded rows on
 * subsequent turns and instead reads the rolling summary from the
 * system prompt, so the on-the-wire prompt stays bounded as
 * conversations stretch across weeks.
 *
 * Behavior:
 *   - Threshold: ~8k tokens of visible content. We estimate at
 *     4 chars/token (Anthropic's published rough rule), so the trigger
 *     is roughly 32k chars of non-superseded message text + tool
 *     payloads.
 *   - Keep window: the last 20 non-superseded messages. The current
 *     turn is part of that window — we only compact if there's at
 *     least 8 messages to absorb, otherwise the operation is a no-op.
 *   - Summary content: feed the prior summary (if any) plus the
 *     messages-to-compact into Sonnet, ask for a tight 6-10 bullet
 *     digest that preserves decisions, commitments, sentiment, and
 *     open questions. Sanitized for em/en dashes per house rules.
 *   - Atomicity: update the thread row first, then stamp messages.
 *     Worst case after a crash mid-stamp is a thread with a fresh
 *     summary that also re-includes some recent messages — that's
 *     redundant context, not wrong context.
 *
 * Designed to run after a successful agent turn from the loop. Safe to
 * call repeatedly: if the thread is under threshold, returns
 * `{ compacted: false }` without making any AI call.
 */

type Supa = SupabaseClient;

/** Approximate char count above which compaction kicks in. */
const CHAR_THRESHOLD = 32_000;

/** Number of most-recent non-superseded messages to keep untouched. */
const KEEP_LAST = 20;

/** Don't compact for fewer than this many absorbable messages — the
 *  AI round-trip isn't worth it for a handful of turns. */
const MIN_TO_ABSORB = 8;

interface CompactResult {
  compacted: boolean;
  reason?: "under_threshold" | "too_few_to_absorb" | "thread_missing";
  absorbed?: number;
  summaryChars?: number;
}

function approxChars(row: AgentMessageRow): number {
  let n = (row.content ?? "").length;
  if (row.tool_calls) {
    try {
      n += JSON.stringify(row.tool_calls).length;
    } catch {
      // ignore
    }
  }
  if (row.tool_results) {
    try {
      n += JSON.stringify(row.tool_results).length;
    } catch {
      // ignore
    }
  }
  return n;
}

function renderMessageForSummary(row: AgentMessageRow): string | null {
  const role = row.role;
  if (role === "system") {
    return row.content ? `[system note] ${row.content}` : null;
  }
  if (role === "user") {
    if (!row.content) return null;
    return `[user]\n${row.content}`;
  }
  if (role === "assistant") {
    const parts: string[] = [];
    if (row.content) parts.push(row.content);
    if (Array.isArray(row.tool_calls)) {
      for (const tc of row.tool_calls as Array<{ name?: string; input?: unknown }>) {
        const name = tc?.name ?? "tool";
        let inputStr = "";
        try {
          inputStr = JSON.stringify(tc?.input ?? {});
        } catch {
          inputStr = "{}";
        }
        parts.push(`[tool call: ${name} ${inputStr.slice(0, 600)}]`);
      }
    }
    if (parts.length === 0) return null;
    return `[assistant]\n${parts.join("\n")}`;
  }
  if (role === "tool") {
    if (!Array.isArray(row.tool_results)) return null;
    const rendered = (row.tool_results as Array<{
      tool_use_id?: string;
      content?: string;
      is_error?: boolean;
    }>).map((r) => {
      const tag = r.is_error ? "tool error" : "tool result";
      const body = (r.content ?? "").slice(0, 600);
      return `[${tag}] ${body}`;
    });
    if (rendered.length === 0) return null;
    return rendered.join("\n");
  }
  return null;
}

/**
 * Compact a thread if it has crossed the size threshold. Returns
 * `{ compacted: false }` when no compaction was needed; returns
 * `{ compacted: true, absorbed, summaryChars }` after a successful
 * compaction.
 *
 * The caller does NOT need to check thresholds first — this function
 * does its own gating and is a no-op when the thread is healthy.
 */
export async function compactThreadIfNeeded(opts: {
  userId: string;
  threadId: string;
  supabase?: Supa;
}): Promise<CompactResult> {
  const supabase = opts.supabase ?? createSupabaseServiceClient();

  // Load only non-superseded rows. We page generously — 500 is the
  // hard cap in loadThread, which is plenty given the trigger
  // threshold is set in chars not row count.
  const { thread, messages } = await loadThread({
    userId: opts.userId,
    threadId: opts.threadId,
    limit: 500,
    supabase,
  });
  if (!thread) return { compacted: false, reason: "thread_missing" };

  const active = messages;
  const totalChars = active.reduce((acc, m) => acc + approxChars(m), 0);
  if (totalChars < CHAR_THRESHOLD) {
    return { compacted: false, reason: "under_threshold" };
  }

  const absorbable = active.slice(0, Math.max(0, active.length - KEEP_LAST));
  if (absorbable.length < MIN_TO_ABSORB) {
    return { compacted: false, reason: "too_few_to_absorb" };
  }

  const rendered: string[] = [];
  for (const row of absorbable) {
    const r = renderMessageForSummary(row);
    if (r) rendered.push(r);
  }
  // Defensive cap on input to the summarizer: even at threshold we
  // want a single Sonnet call to suffice, so trim if the absorb set
  // is massive (very long conversations).
  const joined = rendered.join("\n\n").slice(0, 60_000);

  const prior = thread.summary ?? null;
  const system =
    "You are summarizing one user's conversation with their executive-function agent so the agent can carry it forward bounded. The agent is talking with the user about a specific work item (a task, decision, or thread). Your output is a tight, factual digest, never first-person. Preserve: decisions made, commitments, open questions, named people, deadlines, sentiment shifts, and any concrete actions the agent took. Drop: small talk, repeated context, tool-call mechanics. Output 6 to 10 bullet points. Do not use em-dashes or en-dashes.";

  const userMsg = prior
    ? `# Prior rolling summary\n\n${prior}\n\n# New turns to fold in\n\n${joined}\n\nReturn the merged rolling summary as 6 to 10 bullets.`
    : `# Turns to summarize\n\n${joined}\n\nReturn a rolling summary as 6 to 10 bullets.`;

  const resp = await trackedCreate(
    {
      model: MODELS.secondary,
      max_tokens: 800,
      system,
      messages: [{ role: "user", content: userMsg }],
    },
    "agent:compact_thread",
    opts.userId
  );

  const summaryText = sanitizeForAITells(
    resp.content
      .map((b) => (b.type === "text" ? b.text ?? "" : ""))
      .join("\n")
      .trim()
  );
  if (!summaryText) {
    return { compacted: false, reason: "under_threshold" };
  }

  const now = new Date().toISOString();

  // Update the thread's summary first; if the message stamp fails
  // partway through, the next turn's prompt still benefits.
  const upT = await supabase
    .from("agent_threads")
    .update({ summary: summaryText })
    .eq("user_id", opts.userId)
    .eq("id", opts.threadId);
  if (upT.error) throw upT.error;

  const ids = absorbable.map((m) => m.id);
  if (ids.length > 0) {
    const upM = await supabase
      .from("agent_messages")
      .update({ superseded_by_summary_at: now })
      .eq("user_id", opts.userId)
      .in("id", ids);
    if (upM.error) throw upM.error;
  }

  return {
    compacted: true,
    absorbed: absorbable.length,
    summaryChars: summaryText.length,
  };
}
