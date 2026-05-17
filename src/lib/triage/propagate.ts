import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { MODELS } from "@/lib/anthropic/client";
import { trackedCreate } from "@/lib/anthropic/tracked";

interface ClosedItem {
  id: string;
  title: string;
  description: string | null;
  source_type: string | null;
  company_id: string | null;
  outcome: string | null;
}

interface OpenItem {
  id: string;
  title: string;
  description: string | null;
  source_type: string | null;
  pathway: string;
}

/**
 * Cross-source closure propagation.
 *
 * When the reconciler closes an item (e.g. Linear issue completes), other
 * S2D items in the same portco are often about the same underlying work
 * (a Fireflies action item that originally generated the ticket, a Gmail
 * thread tracking the rollout, etc.). This function finds those siblings
 * and closes them too.
 *
 * Approach:
 *   1. Take the set of items just closed by the reconciler
 *   2. For each, fetch other open items in the same company
 *   3. Ask Haiku — conservatively — which open items are about the same
 *      underlying work
 *   4. Close the matches with an outcome that references the trigger
 *
 * The prompt is deliberately strict: only flag items that are clearly the
 * SAME work, not just topically adjacent. We'd rather miss a few than
 * close items that still need attention.
 */
export async function propagateClosures(
  closedItemIds: string[],
  userId: string
): Promise<{
  cascaded: number;
  details: string[];
}> {
  if (closedItemIds.length === 0) return { cascaded: 0, details: [] };

  const supabase = createSupabaseServiceClient();

  // Fetch closed items — service-role bypasses RLS so scope by user_id.
  const { data: closed } = await supabase
    .from("s2d_items")
    .select("id, title, description, source_type, company_id, outcome")
    .eq("user_id", userId)
    .in("id", closedItemIds);
  if (!closed || closed.length === 0) return { cascaded: 0, details: [] };

  const details: string[] = [];
  let cascaded = 0;
  const alreadyCascadedIds = new Set<string>();

  for (const c of closed as ClosedItem[]) {
    if (!c.company_id) continue;

    // Sibling items in same company AND owned by same user. The user_id
    // filter is crucial — without it, closing a Sidd item could cascade
    // to close a Matt item with the same company name.
    const { data: open } = await supabase
      .from("s2d_items")
      .select("id, title, description, source_type, pathway")
      .eq("user_id", userId)
      .eq("company_id", c.company_id)
      .neq("status", "done")
      .neq("id", c.id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (!open || open.length === 0) continue;

    const candidates = (open as OpenItem[]).filter(
      (o) => !alreadyCascadedIds.has(o.id)
    );
    if (candidates.length === 0) continue;

    const linkedIds = await askHaikuForLinks(c, candidates);
    if (linkedIds.length === 0) continue;

    for (const lid of linkedIds) {
      alreadyCascadedIds.add(lid);
      const target = candidates.find((o) => o.id === lid);
      const { error } = await supabase
        .from("s2d_items")
        .update({
          status: "done",
          done_at: new Date().toISOString(),
          outcome: `Linked closure: "${c.title.slice(0, 100)}"`,
          resolved_via: "auto_detected",
        })
        .eq("user_id", userId)
        .eq("id", lid);
      if (!error) {
        cascaded++;
        details.push(`${target?.title ?? lid} ← linked to "${c.title.slice(0, 60)}"`);
      }
    }
  }

  return { cascaded, details };
}

/**
 * Ask Haiku to identify which open items represent the same underlying
 * work as the just-closed item. Conservative — return [] when unsure.
 */
async function askHaikuForLinks(
  closed: ClosedItem,
  candidates: OpenItem[]
): Promise<string[]> {
  const system = `You decide whether tasks on a board describe the same underlying piece of work.

The user (Sidd) is product lead at Beacon Software. One task just closed. From a list of other open tasks in the same portfolio company, identify which ones describe the SAME work and should therefore also close.

Strict rules:
- Only flag items that are clearly the same underlying piece of work — not just on the same topic or about the same person.
- Examples that ARE same work:
  - Linear issue "Update autoship parsers" closes → Fireflies item "Track autoship parser updates per Artem" should close
  - Gmail thread "Re: SSO migration" closes → Linear issue "SSO migration cutover" tracks the same effort
- Examples that are NOT same work:
  - "Decide pricing for Q3" and "Reply to Maya about pricing" — adjacent but distinct
  - Two unrelated Linear tickets that both mention "billing"
- When in doubt, do NOT include the id.

Output ONLY valid JSON:
{ "linked_ids": [], "rationale": "1 sentence" }
No preamble. No fences.`;

  const user = `CLOSED TASK
source: ${closed.source_type}
title: ${closed.title}
description: ${(closed.description ?? "").slice(0, 300)}
outcome: ${closed.outcome ?? ""}

OPEN TASKS (same company, max 50)
${candidates
  .map(
    (o, i) =>
      `${i + 1}. id=${o.id} | source=${o.source_type} | pathway=${o.pathway}\n   title: ${o.title}\n   desc: ${(o.description ?? "").slice(0, 200)}`
  )
  .join("\n\n")}

Which open task ids are the SAME underlying work? Return JSON.`;

  try {
    // Sonnet — picking the right cross-source matches affects what closes
    // automatically. The intelligence-vs-cost trade clearly favors Sonnet.
    const resp = await trackedCreate(
      {
        model: MODELS.secondary,
        system,
        messages: [{ role: "user", content: user }],
        max_tokens: 400,
      },
      "propagate"
    );
    const text = resp.content[0]?.type === "text" ? resp.content[0].text.trim() : "{}";
    const cleaned = text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    const parsed = JSON.parse(cleaned) as { linked_ids?: string[] };
    if (!Array.isArray(parsed.linked_ids)) return [];
    // Filter to only ids actually in candidates (Haiku occasionally hallucinates)
    const candidateIds = new Set(candidates.map((c) => c.id));
    return parsed.linked_ids.filter((id) => typeof id === "string" && candidateIds.has(id));
  } catch (err) {
    console.warn("[propagate] Haiku failed:", err);
    return [];
  }
}
