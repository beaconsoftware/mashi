import { NextRequest, NextResponse } from "next/server";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";
import { generateHeadsDownPlan } from "@/lib/anthropic/heads-down-plan";
import { generateDecisionBrief } from "@/lib/anthropic/decide-brief";
import { generateTalkingPoints } from "@/lib/anthropic/talking-points";
import { scanActivitySinceLast } from "@/lib/sprint/activity-scan";
import { findCandidateMeetings } from "@/lib/sprint/meeting-match";
import { resolveItemContext } from "@/lib/s2d/context-resolver";
import { buildActionPrompt } from "@/lib/s2d/action-agents";
import { emptyBrief } from "@/lib/s2d/item-brief";
import { trackedCreate } from "@/lib/anthropic/tracked";
import { MODELS } from "@/lib/anthropic/client";
import { getUserContext } from "@/lib/user-context";
import type { EnrichSourceKind } from "@/hooks/use-enriched-context";
import type { Pathway, S2DItem, Priority } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Unified pre-warm endpoint.
 *
 * POST /api/sprint/prewarm
 *
 * Body: { itemId, pathway, reason: "activate" | "queued-soon" | "repathway" }
 *
 * The prewarm-scheduler library on the client calls this when an item
 * enters an active slot, when the active block crosses 90% of its
 * duration (warm queue[0]), or when an item's pathway changes. For each
 * pathway the route fills the appropriate slot on `enriched_context` so
 * the canvas has cooked content on activation.
 *
 * Mapping:
 *   quick_reply / drafted_response → enriched_context.reply_draft
 *   decision_gate                  → enriched_context.decision_brief
 *   heads_down                     → enriched_context.heads_down_plan
 *   meeting_backed                 → enriched_context.talking_points
 *   delegated                      → enriched_context.signals_since_last
 *                                    + enriched_context.nudge_draft (if stale)
 *   watching                       → enriched_context.signals_since_last
 *
 * Response: { ok: true, pathway, fields: string[] } listing the
 * enriched_context keys that were populated. The client doesn't need
 * the actual payload (canvases already poll enriched_context).
 */

interface PrewarmBody {
  itemId?: string;
  pathway?: Pathway;
  reason?: "activate" | "queued-soon" | "repathway";
}

interface EnrichedSource {
  kind: EnrichSourceKind;
  ref: string;
  label: string;
  snippet?: string;
  pinned?: boolean;
}

interface StoredEnrichedContext {
  pulled_sources?: EnrichedSource[];
  reply_draft?: { body: string; generatedAt: string };
  decision_brief?: unknown;
  heads_down_plan?: unknown;
  talking_points?: { bullets: string[]; meetingId?: string | null };
  signals_since_last?: { signals: unknown[]; at: string };
  nudge_draft?: { body: string; tone: "gentle" | "direct" | "escalate" };
  staged_meeting?: { calendarEventId: string; talkingPoints: string };
  // Phase 6: rolling summary of the persistent agent thread for this
  // item, snapshotted at pre-warm time. The canvas reads this to show
  // the user a one-liner under the title (sets expectation that the
  // agent has memory of prior turns). Null when no thread exists or
  // the thread has no summary yet.
  thread_summary?: { text: string; at: string } | null;
}

const SILENCE_DAYS_BY_PRIORITY: Record<Priority, number> = {
  urgent: 1,
  high: 3,
  medium: 7,
  low: 14,
};

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as PrewarmBody;
  const { itemId, pathway, reason = "activate" } = body;
  if (!itemId || !pathway) {
    return NextResponse.json(
      { error: "itemId and pathway required" },
      { status: 400 }
    );
  }

  const userSb = await createSupabaseServerClient();
  const {
    data: { user },
  } = await userSb.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sb = createSupabaseServiceClient();

  const { data: row, error } = await sb
    .from("s2d_items")
    .select("*, company:companies(*), enriched_context")
    .eq("user_id", user.id)
    .eq("id", itemId)
    .single();
  if (error || !row) {
    return NextResponse.json({ error: "item not found" }, { status: 404 });
  }
  const item = row as S2DItem & { enriched_context?: StoredEnrichedContext };

  // Bail if pathway on the item drifted away from the requested one
  // (race: user re-pathwayed after the scheduler enqueued this warm).
  if (item.pathway !== pathway) {
    return NextResponse.json({
      ok: true,
      pathway: item.pathway,
      fields: [],
      skipped: "pathway-drift",
    });
  }

  const enriched: StoredEnrichedContext = { ...(item.enriched_context ?? {}) };
  const sources = (enriched.pulled_sources ?? []).map((s) => ({
    kind: s.kind,
    ref: s.ref,
    label: s.label,
    snippet: (s.snippet ?? "").slice(0, 800),
    pinned: !!s.pinned,
  }));

  const fields: string[] = [];

  // Phase 6: always refresh thread_summary on pre-warm so the canvas
  // shows the latest rolling summary the agent has produced for this
  // item's persistent thread. Cheap (single row, no AI call). Null
  // when no thread or no summary yet — we explicitly write null so
  // a previously-cached value can't go stale across thread compaction
  // events.
  try {
    const t = await sb
      .from("agent_threads")
      .select("summary")
      .eq("user_id", user.id)
      .eq("item_id", item.id)
      .maybeSingle();
    const summary = (t.data as { summary?: string | null } | null)?.summary;
    enriched.thread_summary =
      summary && summary.length > 0
        ? { text: summary, at: new Date().toISOString() }
        : null;
    fields.push("thread_summary");
  } catch {
    // best-effort — never fail prewarm on this lookup
  }

  try {
    if (pathway === "quick_reply" || pathway === "drafted_response") {
      // Only warm when we haven't already cached a draft, or the user
      // re-pathwayed in. For "queued-soon", we still warm fresh — that
      // is the entire point of pre-warming queue[0].
      if (!enriched.reply_draft?.body || reason !== "activate") {
        const draft = await draftReply(sb, item, user.id);
        if (draft) {
          enriched.reply_draft = {
            body: draft,
            generatedAt: new Date().toISOString(),
          };
          fields.push("reply_draft");
        }
      }
    } else if (pathway === "decision_gate") {
      // decision_gate is opt-in only. The scheduler is responsible for
      // gating on block.prewarm_opt_in — if we got here, the user said
      // yes (or it's a re-pathway / queued-soon fresh request).
      if (!enriched.decision_brief || reason === "repathway") {
        const brief = await generateDecisionBrief({
          item,
          sources: sources.map(({ pinned: _pinned, ...rest }) => rest),
          userId: user.id,
        });
        enriched.decision_brief = brief;
        fields.push("decision_brief");
      }
    } else if (pathway === "heads_down") {
      if (!enriched.heads_down_plan || reason === "repathway") {
        const plan = await generateHeadsDownPlan({
          item,
          sources,
          userId: user.id,
        });
        enriched.heads_down_plan = plan;
        fields.push("heads_down_plan");
      }
    } else if (pathway === "meeting_backed") {
      if (!enriched.talking_points || reason === "repathway") {
        // Find the most likely meeting first so the points are anchored
        // to a target — even if the user later picks a different one,
        // the bullets will be in the right ballpark.
        const candidates = await findCandidateMeetings({
          sb,
          userId: user.id,
          item,
          limit: 4,
        });
        const best = candidates[0];
        const points = await generateTalkingPoints({
          item,
          meetingTitle: best?.title ?? null,
          sources: sources.map(({ pinned: _pinned, ...rest }) => rest),
          userId: user.id,
        });
        enriched.talking_points = {
          bullets: points.bullets,
          meetingId: best?.external_id ?? best?.id ?? null,
        };
        fields.push("talking_points");
      }
    } else if (pathway === "watching" || pathway === "delegated") {
      // Activity scan — cheap, idempotent. Always refresh on warm so
      // the canvas shows up-to-the-second signals.
      const sinceISO = await pickWatchSinceISO(sb, user.id, item.id);
      const signals = await scanActivitySinceLast({
        sb,
        userId: user.id,
        itemId: item.id,
        sinceISO,
        delegateMatch:
          pathway === "delegated" ? item.delegated_to ?? null : null,
      });
      enriched.signals_since_last = {
        signals,
        at: new Date().toISOString(),
      };
      fields.push("signals_since_last");

      // For delegated: if silence exceeds the urgency-based threshold
      // AND we haven't already cached a draft, pre-warm a nudge.
      if (pathway === "delegated" && !enriched.nudge_draft) {
        const stale = isDelegateStale(item, signals);
        if (stale) {
          const draft = await draftNudge(sb, item, user.id);
          if (draft) {
            enriched.nudge_draft = { body: draft, tone: "direct" };
            fields.push("nudge_draft");
          }
        }
      }
    }
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "prewarm failed",
        pathway,
      },
      { status: 500 }
    );
  }

  if (fields.length > 0) {
    const { error: upErr } = await sb
      .from("s2d_items")
      .update({ enriched_context: enriched })
      .eq("user_id", user.id)
      .eq("id", item.id);
    if (upErr) {
      return NextResponse.json({ error: upErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, pathway, fields });
}

async function pickWatchSinceISO(
  sb: ReturnType<typeof createSupabaseServiceClient>,
  userId: string,
  itemId: string
): Promise<string> {
  const { data: latest } = await sb
    .from("watch_check_ins")
    .select("at")
    .eq("user_id", userId)
    .eq("s2d_item_id", itemId)
    .order("at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const latestAt = (latest as { at: string } | null)?.at;
  if (latestAt) return latestAt;
  const { data: itemRow } = await sb
    .from("s2d_items")
    .select("created_at")
    .eq("user_id", userId)
    .eq("id", itemId)
    .single();
  return (
    (itemRow as { created_at?: string } | null)?.created_at ??
    new Date(Date.now() - 7 * 86_400_000).toISOString()
  );
}

function isDelegateStale(
  item: Pick<S2DItem, "priority" | "updated_at">,
  signals: Array<{ at: string }>
): boolean {
  const last = signals[0]?.at ?? item.updated_at;
  if (!last) return true;
  const days = (Date.now() - new Date(last).getTime()) / 86_400_000;
  const threshold = SILENCE_DAYS_BY_PRIORITY[item.priority] ?? 7;
  return days >= threshold;
}

async function draftReply(
  sb: ReturnType<typeof createSupabaseServiceClient>,
  item: S2DItem,
  userId: string
): Promise<string | null> {
  const ctx = await resolveItemContext(sb, item);
  const userCtx = await getUserContext(userId);
  const action =
    item.pathway === "quick_reply"
      ? "quick_reply_draft"
      : "drafted_response_prose";
  const prompt = buildActionPrompt(action, {
    item,
    brief: emptyBrief(item.id, MODELS.secondary),
    ctx,
    userName: userCtx.firstName,
  });
  const resp = await trackedCreate(
    {
      model: prompt.model,
      max_tokens: prompt.maxTokens,
      system: prompt.system,
      messages: [{ role: "user", content: prompt.userPrompt }],
    },
    `prewarm:${action}`,
    userId
  );
  const text = resp.content
    .map((b) => (b.type === "text" ? b.text ?? "" : ""))
    .join("\n")
    .trim();
  return text.length > 0 ? text : null;
}

async function draftNudge(
  sb: ReturnType<typeof createSupabaseServiceClient>,
  item: S2DItem,
  userId: string
): Promise<string | null> {
  const ctx = await resolveItemContext(sb, item);
  const userCtx = await getUserContext(userId);
  const prompt = buildActionPrompt("delegated_check_in", {
    item,
    brief: emptyBrief(item.id, MODELS.secondary),
    ctx,
    params: { tone: "direct" },
    userName: userCtx.firstName,
  });
  const resp = await trackedCreate(
    {
      model: prompt.model,
      max_tokens: prompt.maxTokens,
      system: prompt.system,
      messages: [{ role: "user", content: prompt.userPrompt }],
    },
    "prewarm:delegated_nudge",
    userId
  );
  const text = resp.content
    .map((b) => (b.type === "text" ? b.text ?? "" : ""))
    .join("\n")
    .trim();
  return text.length > 0 ? text : null;
}
