import { MODELS } from "@/lib/anthropic/client";
import { trackedCreate } from "@/lib/anthropic/tracked";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { buildTriageSystemPrompt, buildTriageUserPrompt } from "./prompts";
import type { TriageOp, TriageResult, TriageUnit } from "./types";
import type { SourceType } from "@/types";

/**
 * Source types that represent a meeting on their own — calendar invites,
 * Fireflies transcripts, Granola notes. A `meeting_backed` create coming
 * from one of these with no other corroborating signal (gmail thread,
 * Slack message, Linear issue) is almost always noise: the meeting itself
 * is the work surface, and a prep task is rarely actionable in isolation.
 * We reject those creates at the orchestrator and clean up existing ones
 * in the reconcile pass.
 */
const MEETING_ONLY_SOURCES: SourceType[] = ["calendar", "fireflies", "granola"];

/**
 * Run the Sonnet triage agent on a single source unit and apply the
 * resulting operations against the S2D board.
 *
 * Returns counts so each per-source sync can report progress.
 */
export async function runTriageOnUnit(opts: {
  userId: string;
  connectedAccountId: string;
  unit: TriageUnit;
}): Promise<{ created: number; updated: number; closed: number }> {
  const supabase = createSupabaseServiceClient();
  const model = MODELS.secondary;

  let result: TriageResult;
  try {
    result = await callTriageAgent(opts.unit, model, opts.userId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "triage call failed";
    await supabase.from("triage_runs").insert({
      user_id: opts.userId,
      connected_account_id: opts.connectedAccountId,
      source_type: opts.unit.source_type,
      source_unit_id: opts.unit.source_thread_id,
      model,
      operations: [],
      error: msg,
    });
    throw err;
  }

  let created = 0;
  let updated = 0;
  let closed = 0;

  for (const op of result.operations) {
    try {
      const r = await applyOperation(op, opts.unit, opts.userId);
      created += r.created;
      updated += r.updated;
      closed += r.closed;
    } catch (err) {
      console.warn(
        `[triage] failed to apply op for ${opts.unit.source_thread_id}:`,
        err
      );
    }
  }

  await supabase.from("triage_runs").insert({
    user_id: opts.userId,
    connected_account_id: opts.connectedAccountId,
    source_type: opts.unit.source_type,
    source_unit_id: opts.unit.source_thread_id,
    model,
    operations: result.operations as unknown as Record<string, unknown>[],
    input_summary: {
      existing_count: opts.unit.existing_items.length,
      rationale: result.rationale,
    },
    created_count: created,
    updated_count: updated,
    closed_count: closed,
  });

  return { created, updated, closed };
}

async function callTriageAgent(
  unit: TriageUnit,
  model: string,
  userId: string
): Promise<TriageResult> {
  const { getUserContext } = await import("@/lib/user-context");
  const userCtx = await getUserContext(userId);
  const system = buildTriageSystemPrompt({ userName: userCtx.firstName });
  const user = buildTriageUserPrompt(unit);

  const resp = await trackedCreate(
    {
      model,
      system,
      messages: [{ role: "user", content: user }],
      max_tokens: 1500,
    },
    `triage:${unit.source_type}`,
    userId
  );

  const text =
    resp.content[0]?.type === "text" ? resp.content[0].text.trim() : "";
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  let parsed: TriageResult;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Treat unparseable response as noop rather than throwing — protects the
    // rest of the sync from one bad agent call.
    return { rationale: `[unparseable] ${text.slice(0, 200)}`, operations: [] };
  }

  if (!Array.isArray(parsed.operations)) {
    return { rationale: `[bad shape] ${text.slice(0, 200)}`, operations: [] };
  }
  return parsed;
}

async function applyOperation(
  op: TriageOp,
  unit: TriageUnit,
  userId: string
): Promise<{ created: number; updated: number; closed: number }> {
  const supabase = createSupabaseServiceClient();

  if (op.op === "create") {
    if (!op.title || typeof op.title !== "string") {
      console.warn("[triage] create op missing title, skipped");
      return { created: 0, updated: 0, closed: 0 };
    }
    if (!op.pathway) {
      console.warn(`[triage] create op missing pathway for "${op.title}", skipped`);
      return { created: 0, updated: 0, closed: 0 };
    }

    // Meeting-only noise filter: a `meeting_backed` task spawned from a
    // calendar invite / Fireflies transcript / Granola note with no
    // other-source corroboration is almost always noise. The meeting
    // itself is the work surface; a "prep for X" item rarely converts
    // into action. Block at the orchestrator so these don't even hit
    // the review queue. Log the skip so the suppression is visible.
    if (
      op.pathway === "meeting_backed" &&
      MEETING_ONLY_SOURCES.includes(unit.source_type)
    ) {
      await supabase.from("triage_runs").insert({
        user_id: userId,
        source_type: unit.source_type,
        source_unit_id: unit.source_thread_id,
        model: MODELS.secondary,
        operations: [
          {
            op: "skip_meeting_only_prep_create",
            incoming_title: op.title,
            incoming_pathway: op.pathway,
            incoming_priority: op.priority,
            rationale: `meeting_backed from ${unit.source_type} with no cross-source signal`,
          },
        ] as unknown as Record<string, unknown>[],
        input_summary: { skipped_meeting_only_prep: true },
        created_count: 0,
        updated_count: 0,
        closed_count: 0,
      });
      return { created: 0, updated: 0, closed: 0 };
    }

    // Dedup-before-create is THE PRIMARY GATE. Every create runs through
    // Sonnet to check whether an existing open item already represents this
    // work. If yes, the new source signal becomes a linked_sources entry on
    // the existing row, and we may bump the existing item's priority if the
    // new signal is more urgent.
    //
    // When unit.company_id is null (e.g. a gcal event we couldn't map to a
    // portco), dedup still runs against the most-recent open items globally
    // — otherwise a `watching` item created from a gmail thread will never
    // collapse with the calendar invite that resolves it.
    const match = await findSameWorkOpenItem({
      title: op.title,
      description: op.description ?? "",
      pathway: op.pathway,
      priority: op.priority,
      companyId: unit.company_id,
      excludeSourceThreadId: unit.source_thread_id,
      userId,
    });
    // If dedup matched a row already closed, skip the create entirely —
    // the user already resolved this work. Without this, the agent's
    // create slips through, lands a brand-new Review card with
    // needs_review=true, and the user sees "this came back".
    if (match && match.was_closed) {
      await supabase.from("triage_runs").insert({
        user_id: userId,
        source_type: unit.source_type,
        source_unit_id: unit.source_thread_id,
        model: MODELS.secondary,
        operations: [
          {
            op: "dedup_skip_recreate_of_closed",
            into_s2d_item_id: match.id,
            into_title: match.title,
            incoming_title: op.title,
            rationale: match.rationale,
          },
        ] as unknown as Record<string, unknown>[],
        input_summary: {
          dedup: true,
          skipped_recreate_of_closed: true,
          rationale: match.rationale,
        },
        created_count: 0,
        updated_count: 0,
        closed_count: 0,
      });
      return { created: 0, updated: 0, closed: 0 };
    }
    if (match) {
      const newSource = {
        source_type: unit.source_type,
        source_thread_id: unit.source_thread_id,
        source_label: unit.source_label,
        incoming_priority: op.priority,
        incoming_pathway: op.pathway,
        merged_at: new Date().toISOString(),
      };
      const existing = (match.linked_sources ?? []) as Array<Record<string, unknown>>;
      const bumped = maybeBumpedPriority(match.existing_priority, op.priority);
      const updatePatch: Record<string, unknown> = {
        linked_sources: [...existing, newSource],
      };
      if (bumped) updatePatch.priority = bumped;

      // Surface this merge to the user via the notification system. A new
      // source landing on an existing ticket is exactly what they need to
      // see ("a meeting happened that affects this item"). Watch-resolved
      // merges DON'T flip the flag — those close the row, so a pulsing
      // dot on a done-card is just noise.
      const mergeSummary = bumped
        ? `New ${unit.source_type} signal merged in — priority bumped to ${bumped}`
        : `New ${unit.source_type} signal merged in (${unit.source_label})`;

      // If we were `watching` for a thing to happen and the new signal IS
      // that thing happening (calendar invite landed, outbound reply sent),
      // the watch is over — close the merged item with the dedup link as
      // evidence. Without this, the row stays in `watching` forever.
      const watchResolved =
        match.existing_pathway === "watching" &&
        isConfirmingSignal(unit.source_type);
      if (watchResolved) {
        updatePatch.status = "done";
        updatePatch.done_at = new Date().toISOString();
        updatePatch.outcome = `Resolved: thing-being-watched-for happened (linked via dedup from ${unit.source_type})`;
        updatePatch.resolved_via = "auto_detected";
      } else {
        updatePatch.has_unseen_updates = true;
        updatePatch.last_update_summary = mergeSummary;
        updatePatch.last_update_at = new Date().toISOString();
      }

      // user_id scope is defense-in-depth — match.id came from a
      // user-scoped lookup upstream, but never lean on a single check.
      // The .neq("status","done") guards against a race: if the user
      // marked the row done between findSameWorkOpenItem and now, we
      // must not flip it back via has_unseen_updates / pathway / etc.
      await supabase
        .from("s2d_items")
        .update(updatePatch)
        .eq("id", match.id)
        .eq("user_id", userId)
        .neq("status", "done");

      // Audit trail — every dedup decision is logged so it's never silent
      await supabase.from("triage_runs").insert({
        user_id: userId,
        source_type: unit.source_type,
        source_unit_id: unit.source_thread_id,
        model: MODELS.secondary,
        operations: [
          {
            op: "dedup_merge",
            into_s2d_item_id: match.id,
            into_title: match.title,
            incoming_title: op.title,
            priority_bumped: bumped ?? null,
            watch_resolved: watchResolved,
            rationale: match.rationale,
          },
        ] as unknown as Record<string, unknown>[],
        input_summary: { dedup: true, rationale: match.rationale },
        created_count: 0,
        updated_count: watchResolved ? 0 : 1,
        closed_count: watchResolved ? 1 : 0,
      });

      return {
        created: 0,
        updated: watchResolved ? 0 : 1,
        closed: watchResolved ? 1 : 0,
      };
    }

    const status = op.status ?? "todo";
    // AI-triaged items land in the review queue so the user can approve
    // them before they join the board. The agent's status recommendation
    // is preserved — on approve we send the item there.
    const { error } = await supabase.from("s2d_items").insert({
      user_id: userId,
      title: op.title,
      description: op.description ?? null,
      status,
      needs_review: true,
      pathway: op.pathway,
      priority: op.priority,
      est_minutes: op.est_minutes ?? null,
      source_type: unit.source_type,
      source_id: `${unit.source_thread_id}:${slug(op.title)}`,
      source_thread_id: unit.source_thread_id,
      source_label: unit.source_label,
      source_url: unit.source_url,
      company_id: unit.company_id,
      delegated_to: op.delegated_to ?? null,
      queue_reason: status === "in_queue" ? op.queue_reason ?? null : null,
      review_justification: op.justification ?? null,
    });
    if (error) throw error;
    return { created: 1, updated: 0, closed: 0 };
  }

  if (op.op === "update") {
    // Status-only patches are usually "moved to in_queue because still
    // waiting" — bookkeeping, not new info for the user. Skip the unseen
    // flag in that case to avoid pulsing dots on no-real-change updates.
    const contentChanged =
      op.patch.title !== undefined ||
      op.patch.description !== undefined ||
      op.patch.priority !== undefined ||
      op.patch.pathway !== undefined ||
      op.patch.est_minutes !== undefined ||
      op.patch.queue_reason !== undefined;

    // .neq("status","done") guards a race: existing_items for this unit are
    // loaded BEFORE the 2–6s LLM call. If the user marks the item done in
    // that window, the agent's update op would silently re-open it. The
    // matched row is filtered out, the UPDATE no-ops, and the audit row
    // reports updated=0 — which is correct.
    const { error } = await supabase
      .from("s2d_items")
      .update({
        ...(op.patch.title !== undefined && { title: op.patch.title }),
        ...(op.patch.description !== undefined && { description: op.patch.description }),
        ...(op.patch.priority !== undefined && { priority: op.patch.priority }),
        ...(op.patch.pathway !== undefined && { pathway: op.patch.pathway }),
        ...(op.patch.status !== undefined && { status: op.patch.status }),
        ...(op.patch.queue_reason !== undefined && { queue_reason: op.patch.queue_reason }),
        ...(op.patch.est_minutes !== undefined && { est_minutes: op.patch.est_minutes }),
        ...(contentChanged && {
          has_unseen_updates: true,
          last_update_summary: op.reason ?? "Mashi updated this item",
          last_update_at: new Date().toISOString(),
        }),
      })
      .eq("id", op.s2d_item_id)
      .eq("user_id", userId)
      .neq("status", "done");
    if (error) throw error;
    return { created: 0, updated: 1, closed: 0 };
  }

  if (op.op === "close") {
    if (op.confidence === "auto") {
      // .neq("status","done") prevents double-close (would overwrite manual
      // outcome). .lt("updated_at", recentTouchIso) prevents auto-closing
      // an item the user just touched — gives them a 24h grace window
      // even when fresh content suggests closure.
      const recentTouchIso = new Date(
        Date.now() - 24 * 3600 * 1000
      ).toISOString();
      const { error } = await supabase
        .from("s2d_items")
        .update({
          status: "done",
          done_at: new Date().toISOString(),
          outcome: op.outcome,
          resolved_via: "auto_detected",
        })
        .eq("id", op.s2d_item_id)
        .eq("user_id", userId)
        .neq("status", "done")
        .lt("updated_at", recentTouchIso);
      if (error) throw error;
      return { created: 0, updated: 0, closed: 1 };
    } else {
      // Surface an approval-required notification rather than closing.
      // For now we just queue it; the Notifications UI will render it later.
      await supabase.from("notifications").insert({
        user_id: userId,
        type: "close_suggested",
        title: "Mashi suggests closing an item",
        body: op.outcome,
        s2d_item_id: op.s2d_item_id,
        action_url: `/s2d?item=${op.s2d_item_id}`,
      });
      return { created: 0, updated: 0, closed: 0 };
    }
  }

  return { created: 0, updated: 0, closed: 0 };
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/**
 * Fetch S2D items associated with a given source unit so the triage agent
 * has context about what already exists for this thread.
 *
 * Includes both OPEN items AND items closed within the last 30 days. The
 * recently-closed ones carry was_closed=true plus done_at/outcome so the
 * agent can see "this work was already done, don't recreate". Without
 * this signal a Linear-sync running over an already-closed thread would
 * see an empty existing-items list and emit a fresh `create` op,
 * resurrecting the same work as a brand-new ticket in Review.
 */
export async function loadExistingForUnit(
  sourceType: string,
  sourceThreadId: string
): Promise<TriageUnit["existing_items"]> {
  const supabase = createSupabaseServiceClient();
  const thirtyDaysAgoIso = new Date(
    Date.now() - 30 * 86_400_000
  ).toISOString();
  // Combined query: open items always, plus done items closed in the last
  // 30 days. Postgrest `.or` lets us express the dual condition cleanly.
  const { data } = await supabase
    .from("s2d_items")
    .select(
      "id, title, status, pathway, priority, created_at, done_at, outcome, linked_sources"
    )
    .eq("source_type", sourceType)
    .eq("source_thread_id", sourceThreadId)
    .or(`status.neq.done,and(status.eq.done,done_at.gte.${thirtyDaysAgoIso})`);
  return (data ?? []).map((it) => {
    const { linked_sources, done_at, outcome, status, ...rest } = it as typeof it & {
      linked_sources?: unknown[] | null;
      done_at?: string | null;
      outcome?: string | null;
    };
    const wasClosed = status === "done";
    return {
      ...rest,
      status,
      linked_sources_count: Array.isArray(linked_sources)
        ? linked_sources.length
        : 0,
      ...(wasClosed && {
        was_closed: true,
        done_at: done_at ?? null,
        outcome: outcome ?? null,
      }),
    };
  });
}

/**
 * Dedup-before-create — every new S2D item runs through this first.
 *
 * Design principle: ONE S2D row per unit of work, full stop. Sources
 * attach to it as signals. The board tracks WORK, not source events.
 *
 * Sonnet does the judgment. No keyword pre-filter — keyword overlap is a
 * weak signal for "same work" (e.g. "Update pricing for Q3" and "Reply
 * to Maya about prioritization" can be the same work with zero word
 * overlap). Forget cost.
 *
 * Returns the match info + an optional priority/pathway upgrade if the
 * new signal is more urgent than the existing item.
 */
interface DedupMatch {
  id: string;
  title: string;
  linked_sources: unknown[];
  existing_priority: string;
  existing_pathway: string;
  rationale: string;
  /**
   * True when the dedup-matched row is already done. Caller skips the
   * create entirely so we don't re-instantiate work the user just
   * closed. Defense in depth alongside loadExistingForUnit's was_closed
   * signal — that one only catches matches on the SAME source_thread_id.
   */
  was_closed?: boolean;
}

async function findSameWorkOpenItem(args: {
  title: string;
  description: string;
  pathway: string;
  priority: string;
  companyId: string | null;
  excludeSourceThreadId: string;
  userId: string;
}): Promise<DedupMatch | null> {
  const supabase = createSupabaseServiceClient();

  // Candidate pool: 100 most-recent items belonging to THIS USER. Includes
  // open items AND items closed in the last 30 days — so that if the new
  // signal is the same work as something the user just closed, we can
  // detect it and skip the create rather than resurrecting it.
  // Service-role bypasses RLS, so we must filter by user_id explicitly.
  const thirtyDaysAgoIso = new Date(
    Date.now() - 30 * 86_400_000
  ).toISOString();
  let query = supabase
    .from("s2d_items")
    .select(
      "id, title, description, status, source_type, source_thread_id, source_label, linked_sources, priority, pathway, done_at"
    )
    .eq("user_id", args.userId)
    .or(`status.neq.done,and(status.eq.done,done_at.gte.${thirtyDaysAgoIso})`)
    .order("created_at", { ascending: false })
    .limit(100);
  if (args.companyId) {
    query = query.eq("company_id", args.companyId);
  }
  const { data: candidates } = await query;

  if (!candidates || candidates.length === 0) return null;

  // Drop the exact-same source thread (would self-match)
  const pool = candidates.filter((c) => c.source_thread_id !== args.excludeSourceThreadId);
  if (pool.length === 0) return null;

  const system = `You are the dedup gatekeeper for Sidd's task board.

The board tracks ONE row per unit of work — never per source event. The same piece of work can show up in Linear, Gmail, Slack, and Fireflies, and they should ALL collapse into one row. Your job is to decide whether a proposed new task is the same underlying work as something already on the board.

# What counts as same work
- Same concrete deliverable, decision, or commitment, regardless of source
- A Linear ticket and the Fireflies action item that birthed it = same work
- An email thread and the Slack DM continuing the same conversation = same work
- A "track X" / "follow up on X" item and the actual X task = same work
- A parent task and a sub-task narrow enough that there's only one real action = same work
- A "watching" item for someone to send/schedule/reschedule something AND a new calendar invite from that same person FOR that thing = same work — merge so the watch can close
- A "watching" item for someone to reply AND a new gmail thread that IS the reply from that person = same work
- A "drafted_response" item to email X AND a new sent-mail signal showing the reply went out = same work

# What is NOT same work
- Two items mentioning the same person or topic but about different deliverables (e.g. "Reply to Maya about Q3 roadmap" vs "Reply to Maya about pricing model" — same person, different decisions)
- Two items in the same broad project but each requiring a distinct discrete action (e.g. "Decide pricing for Q3" vs "Communicate pricing to sales" — sequential, both real)
- Generic versions vs specific ones (e.g. "Triage Linear backlog" vs "Update MAP-412 autoship parsers" — one is meta, the other concrete)

# Already-closed items in the pool
Some items in the candidate list may show "[CLOSED]" with a done_at date. They were closed by Sidd already. If the proposed new task is the SAME work as one of those, you should STILL match it — the caller uses the match to skip the create entirely (so we don't recreate work the user just closed). Be especially careful here: only match a closed item if you're confident it's the same work, not just topically related.

# Calibration
- "Balance between noise (over-creating dups) and consolidation (wrongly merging) is paramount."
- When confident → return the match_id.
- When unsure → return null. A duplicate caught later is a smaller cost than a wrong merge that silently absorbs work.

# Output
Strict JSON, no fences, no preamble:
{
  "match_id": "<id>" | null,
  "rationale": "1 short sentence explaining the decision"
}`;

  const user = `PROPOSED NEW TASK
title: ${args.title}
description: ${args.description.slice(0, 500)}
incoming_pathway: ${args.pathway}
incoming_priority: ${args.priority}

EXISTING TASKS in this company (${pool.length}) — includes open items AND items closed in the last 30 days:
${pool
  .map((c, i) => {
    const linkedCount = Array.isArray(c.linked_sources) ? c.linked_sources.length : 0;
    const closedTag =
      c.status === "done"
        ? ` [CLOSED ${c.done_at ? c.done_at.slice(0, 10) : ""}]`
        : "";
    return `${i + 1}. id=${c.id}${closedTag}
   source: ${c.source_type} (${c.source_label ?? ""})${linkedCount > 0 ? ` [+${linkedCount} linked]` : ""}
   pathway: ${c.pathway} | priority: ${c.priority}
   title: ${c.title}
   desc: ${(c.description ?? "").slice(0, 250)}`;
  })
  .join("\n\n")}

Is the proposed task the same underlying work as any of these? Strict JSON only.`;

  try {
    const resp = await trackedCreate(
      {
        model: MODELS.secondary,
        system,
        messages: [{ role: "user", content: user }],
        max_tokens: 300,
      },
      "dedup_before_create",
      args.userId
    );
    const text = resp.content[0]?.type === "text" ? resp.content[0].text.trim() : "{}";
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const parsed = JSON.parse(cleaned) as { match_id?: string | null; rationale?: string };
    if (!parsed.match_id) return null;
    const matched = pool.find((c) => c.id === parsed.match_id);
    if (!matched) return null;
    return {
      id: matched.id,
      title: matched.title,
      linked_sources: (matched.linked_sources as unknown[]) ?? [],
      existing_priority: matched.priority,
      existing_pathway: matched.pathway,
      rationale: parsed.rationale ?? "",
      was_closed: matched.status === "done",
    };
  } catch {
    return null;
  }
}

/**
 * Whether an incoming source signal counts as "the thing happened" for a
 * `watching` item. A calendar invite is the strongest signal — someone we
 * were waiting on actually scheduled the thing. Sent-reply detection lives
 * in the source-specific extractors and arrives here as source_type but
 * with a label we can't introspect, so for now we restrict auto-close to
 * calendar events. Gmail/slack confirmations stay as bare merges (priority
 * bump only) — Sidd can close them by hand if the agent didn't catch it.
 */
function isConfirmingSignal(sourceType: string): boolean {
  return sourceType === "calendar";
}

/**
 * When dedup matches, decide if the new signal warrants bumping the
 * existing item's priority. urgent > high > medium > low. Pathway is left
 * alone — that's a judgment call the triage agent already made for the
 * canonical item.
 */
function maybeBumpedPriority(
  existing: string,
  incoming: string
): string | null {
  const rank: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
  const e = rank[existing] ?? 99;
  const i = rank[incoming] ?? 99;
  if (i < e) return incoming;
  return null;
}

