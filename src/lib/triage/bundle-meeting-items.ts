import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { MODELS } from "@/lib/anthropic/client";
import { trackedCreate } from "@/lib/anthropic/tracked";
import type { Pathway, Priority } from "@/types";

interface Row {
  id: string;
  title: string;
  description: string | null;
  source_thread_id: string;
  pathway: Pathway;
  priority: Priority;
  company_id: string | null;
  linked_sources: Array<Record<string, unknown>> | null;
}

/**
 * Same-meeting bundler.
 *
 * The general consolidate pass is conservative — "same work" is a high bar.
 * But Fireflies triage has a known failure mode: ONE meeting that
 * discusses ONE initiative gets exploded into 6-10 separate S2Ds, one per
 * action item per assignee. From the user's perspective those are all the
 * same work — one rollup, one client communication, one decision. The
 * board ends up with 11 rows about Snailworks when it should have 2-3.
 *
 * This pass groups open items by their source_thread_id (the Fireflies
 * meeting external_id), and for any meeting with 3+ open items, asks
 * Sonnet to bundle action items that belong to ONE initiative into ONE
 * canonical row. The bar for bundling here is much lower than the general
 * consolidate — same meeting + same project/initiative = bundle.
 */
export async function bundleSameMeetingActionItems(): Promise<{
  meetingsScanned: number;
  bundlesCreated: number;
  itemsMerged: number;
  details: string[];
}> {
  const supabase = createSupabaseServiceClient();
  const details: string[] = [];
  let bundlesCreated = 0;
  let itemsMerged = 0;

  // Pull all open Fireflies items grouped by source thread (= meeting external_id)
  const { data: items } = await supabase
    .from("s2d_items")
    .select(
      "id, title, description, source_thread_id, pathway, priority, company_id, linked_sources"
    )
    .eq("source_type", "fireflies")
    .neq("status", "done")
    .not("source_thread_id", "is", null);

  if (!items || items.length === 0) {
    return { meetingsScanned: 0, bundlesCreated: 0, itemsMerged: 0, details: [] };
  }

  const byMeeting = new Map<string, Row[]>();
  for (const it of items as Row[]) {
    const key = it.source_thread_id;
    if (!byMeeting.has(key)) byMeeting.set(key, []);
    byMeeting.get(key)!.push(it);
  }

  // Only inspect meetings with 3+ open items — the explosion case
  const meetingsToScan = [...byMeeting.entries()].filter(([, group]) => group.length >= 3);

  for (const [meetingId, group] of meetingsToScan) {
    try {
      const bundles = await askToBundle(meetingId, group);
      for (const bundle of bundles) {
        if (bundle.itemIds.length < 2) continue;
        await applyBundle(supabase, group, bundle);
        bundlesCreated++;
        itemsMerged += bundle.itemIds.length - 1; // -1 because canonical stays open
        details.push(
          `${meetingId}: bundled ${bundle.itemIds.length} items as "${bundle.canonicalTitle.slice(0, 80)}"`
        );
      }
    } catch (err) {
      console.warn(`[bundle] meeting ${meetingId} failed:`, err);
    }
  }

  return {
    meetingsScanned: meetingsToScan.length,
    bundlesCreated,
    itemsMerged,
    details,
  };
}

interface BundleProposal {
  itemIds: string[];
  canonicalTitle: string;
  canonicalDescription: string;
  canonicalPathway: Pathway;
  canonicalPriority: Priority;
  rationale: string;
}

async function askToBundle(meetingId: string, items: Row[]): Promise<BundleProposal[]> {
  const system = `You are bundling action items from a single Fireflies meeting on Sidd's task board.

These ${items.length} action items ALL came from the same meeting. Sidd has explicitly told Mashi: "The board tracks WORK, not sources" and "Balance between noise and consolidation is paramount — forget cost."

Default to BUNDLING. Multiple action items from one meeting that all advance the same initiative, project, customer rollout, or decision should collapse into ONE S2D for that initiative. The breakdown of who-does-what belongs in the description, not as separate board rows.

# Examples of correct bundling
- "Deborah does manual rollups" + "Taylor oversees rollup process" + "Sidd communicates rollup timeline to client" + "Schedule meeting to review rollup" → ONE bundle: "Snailworks roll-up band-aid rollout"
- "Update pricing doc" + "Send pricing to sales" + "Decide pricing tier names" → ONE bundle: "Pricing finalization"

# Examples of NOT bundling
- Two action items about completely unrelated projects that just happened to be discussed in the same meeting (e.g. "Q3 pricing decision" AND "hire a new analyst" — different initiatives even if same meeting)
- A meta-task ("triage the backlog") and a concrete task ("ship MAP-412")

# How to pick the canonical row
- Title names the INITIATIVE, not a single action ("Snailworks roll-up band-aid rollout", not "Draft message to Deborah")
- Description lists the breakdown: who's doing what, what decisions are pending, what's next
- Pathway: use "delegated" if the work is mostly assigned to others, "heads_down" if it's mostly Sidd's, "decision_gate" if a key decision is pending, "watching" if Sidd is just tracking
- Priority: highest of the bundled items

# Output
Strict JSON, no fences, no preamble:
{
  "bundles": [
    {
      "itemIds": ["<id1>", "<id2>", ...],
      "canonicalTitle": "Initiative name",
      "canonicalDescription": "Breakdown of sub-tasks / assignees / status",
      "canonicalPathway": "delegated" | "watching" | "heads_down" | "decision_gate" | "meeting_backed" | "quick_reply" | "drafted_response",
      "canonicalPriority": "urgent" | "high" | "medium" | "low",
      "rationale": "1 sentence why these are one initiative"
    }
  ]
}

Items that don't bundle with anything are NOT in any bundle (single-item bundles are not valid).
If no bundles are warranted: { "bundles": [] }.`;

  const user = `Meeting external_id: ${meetingId}

Action items from this meeting (${items.length} total open):
${items
  .map(
    (it, i) =>
      `${i + 1}. id=${it.id} | pathway=${it.pathway} | priority=${it.priority}
   title: ${it.title}
   desc: ${(it.description ?? "").slice(0, 240)}`
  )
  .join("\n\n")}

Which sets are about the same underlying initiative? Default to bundling — return all the bundles.`;

  // Opus — bundling is the highest-judgment call in the whole triage
  // pipeline. The agent must (a) decide what counts as "one initiative",
  // (b) rewrite the canonical title and description, and (c) pick the
  // right pathway / priority for the absorbed cluster. A wrong bundle
  // silently swallows real work; the right bundle dramatically reduces
  // board noise. User has explicitly said cost is not the constraint.
  const resp = await trackedCreate(
    {
      model: MODELS.primary,
      system,
      messages: [{ role: "user", content: user }],
      max_tokens: 2000,
    },
    "bundle_meeting"
  );

  const text = resp.content[0]?.type === "text" ? resp.content[0].text.trim() : "{}";
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned) as { bundles?: BundleProposal[] };
    if (!Array.isArray(parsed.bundles)) return [];
    const validIds = new Set(items.map((i) => i.id));
    return parsed.bundles
      .map((b) => ({
        ...b,
        itemIds: b.itemIds.filter((id) => validIds.has(id)),
      }))
      .filter((b) => b.itemIds.length >= 2);
  } catch {
    return [];
  }
}

type SB = ReturnType<typeof createSupabaseServiceClient>;

async function applyBundle(
  supabase: SB,
  groupItems: Row[],
  bundle: BundleProposal
): Promise<void> {
  const itemsInBundle = groupItems.filter((g) => bundle.itemIds.includes(g.id));
  if (itemsInBundle.length < 2) return;

  // Pick canonical: highest priority, then most-recent. We rewrite its
  // title/description with the bundle's canonical values.
  const priorityRank: Record<Priority, number> = {
    urgent: 0,
    high: 1,
    medium: 2,
    low: 3,
  };
  itemsInBundle.sort(
    (a, b) => priorityRank[a.priority] - priorityRank[b.priority]
  );
  const [canonical, ...dupes] = itemsInBundle;

  // Append dupes to canonical.linked_sources with merged_from_s2d_id
  // breadcrumbs so we never lose attribution.
  const additionalSources = dupes.map((d) => ({
    source_type: "fireflies",
    source_thread_id: d.source_thread_id,
    source_label: d.title.slice(0, 120),
    merged_from_s2d_id: d.id,
    merged_at: new Date().toISOString(),
    original_title: d.title,
  }));
  const newLinkedSources = [
    ...((canonical.linked_sources as unknown[]) ?? []),
    ...additionalSources,
  ];

  await supabase
    .from("s2d_items")
    .update({
      title: bundle.canonicalTitle,
      description: bundle.canonicalDescription,
      pathway: bundle.canonicalPathway,
      priority: bundle.canonicalPriority,
      linked_sources: newLinkedSources,
      has_unseen_updates: true,
      last_update_summary: `Bundled ${dupes.length} related item${dupes.length === 1 ? "" : "s"} into this one`,
      last_update_at: new Date().toISOString(),
    })
    .eq("id", canonical.id);

  for (const d of dupes) {
    await supabase
      .from("s2d_items")
      .update({
        status: "done",
        done_at: new Date().toISOString(),
        outcome: `Bundled into "${bundle.canonicalTitle.slice(0, 100)}" (same-meeting initiative)`,
        resolved_via: "auto_detected",
      })
      .eq("id", d.id);
  }
}
