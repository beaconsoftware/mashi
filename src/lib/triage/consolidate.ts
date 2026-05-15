import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { MODELS } from "@/lib/anthropic/client";
import { trackedCreate } from "@/lib/anthropic/tracked";
import type { Pathway, Priority } from "@/types";

interface S2DRow {
  id: string;
  title: string;
  description: string | null;
  source_type: string | null;
  source_id: string | null;
  source_thread_id: string | null;
  source_label: string | null;
  status: string;
  pathway: Pathway;
  priority: Priority;
  company_id: string | null;
  linked_sources: Array<Record<string, unknown>>;
  created_at: string;
  updated_at: string;
}

/**
 * One-time consolidation: walk current open S2D items, cluster duplicates
 * per company via Haiku, and merge each cluster into one canonical row.
 *
 * The canonical row keeps its identity; the others' source signals get
 * appended to its `linked_sources` JSONB. The duplicates are then marked
 * `done` with outcome="Merged into ${canonical.title}" so the audit trail
 * is preserved.
 */
export async function consolidateDuplicates(): Promise<{
  clustersFound: number;
  merged: number;
  details: string[];
}> {
  const supabase = createSupabaseServiceClient();
  const details: string[] = [];
  let clustersFound = 0;
  let merged = 0;

  // One pass per company. We deliberately scope to OPEN items only; closed
  // items already auto-document themselves.
  const { data: companies } = await supabase.from("companies").select("id, name");
  if (!companies) return { clustersFound: 0, merged: 0, details: [] };

  for (const company of companies) {
    const { data: items } = await supabase
      .from("s2d_items")
      .select(
        "id, title, description, source_type, source_id, source_thread_id, source_label, status, pathway, priority, company_id, linked_sources, created_at, updated_at"
      )
      .eq("company_id", company.id)
      .neq("status", "done")
      .order("created_at", { ascending: true })
      .limit(200);

    if (!items || items.length < 2) continue;

    const clusters = await clusterItemsByWork(items as S2DRow[], company.name);
    for (const cluster of clusters) {
      if (cluster.length < 2) continue;
      clustersFound++;

      // Pick the canonical: most recent OR the one with the richest source.
      // Heuristic: prefer items with priority urgent/high (more signal),
      // breaking ties by most-recent updated_at.
      const priorityRank: Record<Priority, number> = {
        urgent: 0,
        high: 1,
        medium: 2,
        low: 3,
      };
      cluster.sort((a, b) => {
        const p = priorityRank[a.priority] - priorityRank[b.priority];
        if (p !== 0) return p;
        return b.updated_at.localeCompare(a.updated_at);
      });
      const [canonical, ...dupes] = cluster;

      // Build the merged linked_sources array
      const additionalSources = dupes.map((d) => ({
        source_type: d.source_type,
        source_id: d.source_id,
        source_thread_id: d.source_thread_id,
        source_label: d.source_label,
        merged_from_s2d_id: d.id,
        merged_at: new Date().toISOString(),
      }));
      const newLinkedSources = [
        ...(canonical.linked_sources ?? []),
        ...additionalSources,
      ];

      await supabase
        .from("s2d_items")
        .update({
          linked_sources: newLinkedSources,
          has_unseen_updates: true,
          last_update_summary: `Merged ${dupes.length} duplicate source${dupes.length === 1 ? "" : "s"} into this item`,
          last_update_at: new Date().toISOString(),
        })
        .eq("id", canonical.id);

      // Mark duplicates as merged (status=done, outcome explains)
      for (const d of dupes) {
        await supabase
          .from("s2d_items")
          .update({
            status: "done",
            done_at: new Date().toISOString(),
            outcome: `Merged into "${canonical.title.slice(0, 100)}"`,
            resolved_via: "auto_detected",
          })
          .eq("id", d.id);
        merged++;
      }

      details.push(
        `${company.name}: merged ${dupes.length} sources into "${canonical.title.slice(0, 80)}"`
      );
    }
  }

  return { clustersFound, merged, details };
}

/**
 * Use Haiku to cluster items by underlying unit of work. The agent returns
 * groups of item IDs that describe the SAME work — different sources are
 * fine, even welcomed (cross-source clustering is the whole point).
 *
 * Returns an array of clusters, each cluster being the list of items that
 * are the same work. Single-item "clusters" are filtered out by the caller.
 */
async function clusterItemsByWork(items: S2DRow[], companyName: string): Promise<S2DRow[][]> {
  // Chunk large company boards to keep prompt size reasonable
  const CHUNK = 80;
  const allClusters: S2DRow[][] = [];

  for (let i = 0; i < items.length; i += CHUNK) {
    const slice = items.slice(i, i + CHUNK);
    try {
      const clusters = await askHaikuToCluster(slice, companyName);
      allClusters.push(...clusters);
    } catch (err) {
      console.warn(`[consolidate] cluster pass ${i / CHUNK} failed:`, err);
    }
  }

  return allClusters;
}

async function askHaikuToCluster(
  items: S2DRow[],
  companyName: string
): Promise<S2DRow[][]> {
  const system = `You cluster tasks on Sidd's board by their underlying piece of work.

The board has many items. Some are duplicates of the same underlying work, surfaced from different sources (a Linear ticket, a Fireflies action item, a Gmail thread, a Slack DM — all about the same project). Some are different action items extracted from the SAME meeting that all belong to ONE coherent initiative.

Your job: identify clusters of 2+ items that describe the SAME underlying work or initiative.

# What clusters
- Same concrete deliverable, project, decision, or rollout.
- Same broader initiative with multiple sub-tasks distributed to different people. E.g., "Snailworks roll-up band-aid": Deborah doing manual rollups, Taylor overseeing, Sidd communicating timeline — these are ONE initiative even though each is a different action item.
- Cross-source matches: a Linear ticket + the Fireflies action item that birthed it + the Gmail thread tracking progress.
- A "track / follow up on X" item and the actual X task.
- Multiple items that all close when the parent project ships.

# When to be MORE aggressive about clustering
- When items share the same source_thread_id (same Fireflies meeting, same Gmail thread, same Linear issue), they almost certainly belong together. Lean toward clustering unless they're obviously about different projects discussed in passing.
- When titles mention the same project name, customer, deliverable, or initiative.
- When the items form an obvious dependency chain (decide pricing → communicate pricing → implement pricing — these are sub-steps of one initiative).

# What does NOT cluster
- Two tickets that touch the same system but for genuinely different features
- Two emails to the same person about different topics
- Two items where one is a meta-task ("review the Linear backlog") and the other is concrete ("ship MAP-412")

# Calibration
Default to clustering when the items share a project, initiative, or source thread. False merges are easier to spot and split than per-meeting explosion is to clean up. Sidd has explicitly told Mashi: "The board tracks WORK, not sources. Balance between noise and consolidation is paramount."

Output ONLY valid JSON of this exact shape:
{ "clusters": [ { "ids": ["...", "..."], "rationale": "1 sentence" } ] }
No preamble. No fences. Each cluster must have at least 2 ids. Singletons should NOT be returned.`;

  const user = `Company: ${companyName}

Open tasks (${items.length}):
${items
  .map(
    (it, i) =>
      `${i + 1}. id=${it.id} | source=${it.source_type} | thread=${it.source_thread_id ?? "?"} | pathway=${it.pathway} | priority=${it.priority}\n   title: ${it.title}\n   desc: ${(it.description ?? "").slice(0, 240)}`
  )
  .join("\n\n")}

Note: items with the same \`thread=\` belong to the same source unit (e.g., same Fireflies meeting, same Gmail thread). Lean toward clustering these unless they're obviously distinct projects.

Which sets of ids are about the same underlying work? Return JSON.`;

  // Sonnet — clustering "is this the same unit of work" requires real
  // semantic judgment, not pattern matching. Haiku's false-merge rate is
  // unacceptable when the cost of a wrong merge is silently losing a task.
  const resp = await trackedCreate(
    {
      model: MODELS.secondary,
      system,
      messages: [{ role: "user", content: user }],
      max_tokens: 1500,
    },
    "consolidate"
  );

  const text = resp.content[0]?.type === "text" ? resp.content[0].text.trim() : "{}";
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned) as {
      clusters?: Array<{ ids: string[]; rationale?: string }>;
    };
    if (!Array.isArray(parsed.clusters)) return [];
    const byId = new Map(items.map((it) => [it.id, it]));
    return parsed.clusters
      .map((c) => c.ids.map((id) => byId.get(id)).filter((x): x is S2DRow => !!x))
      .filter((cluster) => cluster.length >= 2);
  } catch {
    return [];
  }
}
