import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { MODELS } from "@/lib/anthropic/client";
import { trackedCreate } from "@/lib/anthropic/tracked";

interface OpenItem {
  id: string;
  title: string;
  description: string | null;
  queue_reason: string | null;
  ai_suggestion: string | null;
  source_label: string | null;
  pathway: string;
  priority: string;
  created_at: string;
}

/**
 * AI common-sense pass. For every open S2D item, Haiku decides whether the
 * item's own content makes it clearly NO LONGER ACTIONABLE.
 *
 * Catches cases the source-based reconcilers can't:
 *   - "Dinner Mon 5/4 6:30pm" where 5/4 is already past
 *   - "Reply to Q3 deck review by Friday" where Friday was last week
 *   - "Prep for the May 2 board meeting" where May 2 has passed
 *
 * Strict: when the date is ambiguous or no clear time reference, do NOT close.
 */
export async function aiStalenessReview(userId: string): Promise<{
  closed: number;
  closedIds: string[];
  details: string[];
}> {
  const supabase = createSupabaseServiceClient();
  const { data: items } = await supabase
    .from("s2d_items")
    .select(
      "id, title, description, queue_reason, ai_suggestion, source_label, pathway, priority, created_at"
    )
    .eq("user_id", userId)
    .neq("status", "done")
    .order("created_at", { ascending: false })
    .limit(800);

  if (!items || items.length === 0) {
    return { closed: 0, closedIds: [], details: [] };
  }

  const closedIds: string[] = [];
  const details: string[] = [];

  const BATCH = 30;
  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH) as OpenItem[];
    try {
      const stale = await askHaikuForStale(batch);
      for (const sid of stale) {
        const target = batch.find((b) => b.id === sid.id);
        if (!target) continue;
        // .neq("status","done") so we don't overwrite a user's manual
        // outcome with our stale auto-close one if they beat us to it.
        // .lt("updated_at", recentTouchIso) skips items the user touched
        // in the last 24h — e.g. they manually re-opened a stale-looking
        // item, which they shouldn't have to defend from being re-closed
        // on the next reconcile pass.
        const recentTouchIso = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
        const { error } = await supabase
          .from("s2d_items")
          .update({
            status: "done",
            done_at: new Date().toISOString(),
            outcome: `Auto-closed (stale): ${sid.reason}`,
            resolved_via: "auto_detected",
          })
          .eq("user_id", userId)
          .eq("id", sid.id)
          .neq("status", "done")
          .lt("updated_at", recentTouchIso);
        if (!error) {
          closedIds.push(sid.id);
          details.push(`${target.title.slice(0, 60)} → ${sid.reason}`);
        }
      }
    } catch (err) {
      console.warn(`[ai-staleness] batch ${i / BATCH} failed:`, err);
    }
  }

  return { closed: closedIds.length, closedIds, details };
}

interface StaleHit {
  id: string;
  reason: string;
}

async function askHaikuForStale(items: OpenItem[]): Promise<StaleHit[]> {
  const today = new Date().toISOString().slice(0, 10);

  const system = `You review tasks on Sidd's task board and decide which ones are obviously NO LONGER ACTIONABLE based on their own content.

Today's date: ${today}.

CLOSE a task only if ANY of its fields (title, queue_reason, ai_suggestion, desc) show the work is clearly past — examples:
- The task references a specific date that is now in the past, AND the task is the kind of thing that's resolved once that date passes (a dinner, a meeting, a prep task for a specific event, a deadline that has expired with no rolling action).
- The task is about attending or prepping for a SPECIFIC instance of a meeting on a specific date that is past ("Attend MPP Weekly IPM" with queue_reason saying "Meeting is today Mon May 11" — May 11 is past → close it, the meeting is over). The fact that the meeting is part of a recurring series does not matter — this specific instance has passed.
- The task is about a one-time event ("Dinner Mon 5/4", "Q1 board prep", "May 2 demo") and the event date is past.
- The task references "this week" / "next Friday" with enough context that the date is unambiguous AND past.

DO NOT close:
- Tasks with no time reference anywhere ("Reply to Maya about Q3 roadmap")
- Tasks where the date is ambiguous (no year, could be future)
- Tasks tracking someone's ONGOING work over time (e.g. "Track Grant's onboarding") — these stay open even if some referenced date is past, because the tracking continues.
- Tasks for events whose referenced date is clearly in the FUTURE (don't close anything dated after today).
- Tasks where you're not 100% sure the date is past

Be conservative. False positives (closing live items) are much worse than leaving stale items open.

Output ONLY JSON of this shape, nothing else:
{ "stale": [ { "id": "...", "reason": "short why (under 80 chars)" } ] }
If nothing is stale: { "stale": [] }
No preamble. No markdown fences.`;

  const user = `Open tasks:
${items
  .map((it, i) => {
    // Compose all the context fields that might carry the time reference.
    // Date info usually lives in queue_reason (e.g. "Meeting is today Mon May 11 at 3:30pm")
    // or ai_suggestion, NOT description (often empty on synced items).
    const ctx = [
      it.queue_reason ? `queue_reason: ${it.queue_reason.slice(0, 240)}` : null,
      it.ai_suggestion ? `ai_suggestion: ${it.ai_suggestion.slice(0, 240)}` : null,
      it.description ? `desc: ${it.description.slice(0, 240)}` : null,
    ]
      .filter(Boolean)
      .join("\n   ");
    return `${i + 1}. id=${it.id}\n   title: ${it.title}\n   pathway: ${it.pathway}\n   created: ${it.created_at.slice(0, 10)}\n   source: ${it.source_label ?? ""}\n   ${ctx || "(no extra context)"}`;
  })
  .join("\n\n")}

Which task ids are clearly no longer actionable as of ${today}? Return JSON.`;

  // Sonnet, not Haiku — staleness review is a judgment call about whether
  // a task is genuinely past vs. just date-ambiguous. Haiku was too eager
  // to close watching items and too cautious on past-meeting prep tasks.
  // The user has explicitly said "forget cost" on dedup/cleanup quality.
  const resp = await trackedCreate(
    {
      model: MODELS.secondary,
      system,
      messages: [{ role: "user", content: user }],
      max_tokens: 1000,
    },
    "ai_staleness"
  );

  const text = resp.content[0]?.type === "text" ? resp.content[0].text.trim() : "{}";
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    const parsed = JSON.parse(cleaned) as { stale?: StaleHit[] };
    if (!Array.isArray(parsed.stale)) return [];
    const allowedIds = new Set(items.map((i) => i.id));
    return parsed.stale.filter(
      (s) => s && typeof s.id === "string" && allowedIds.has(s.id) && typeof s.reason === "string"
    );
  } catch {
    return [];
  }
}
