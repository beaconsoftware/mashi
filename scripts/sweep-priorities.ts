/**
 * One-time priority recalibration sweep.
 *
 * Mashi accumulated a bias toward urgent/high because the old prompt
 * was too permissive ("exec/customer waiting" alone fired urgent on
 * every portco email). After updating the prompt + adding the
 * linked_sources_count recurrence signal, this script re-evaluates
 * every currently-urgent and currently-high open item for a user
 * under the new calibration in a single batched LLM call.
 *
 *   pnpm tsx scripts/sweep-priorities.ts <user-id> [--dry-run]
 *
 * --dry-run prints the proposed reassignments without writing.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

for (const line of readFileSync(resolve(process.cwd(), ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
  if (!m) continue;
  const [, k, v] = m;
  if (!process.env[k]) process.env[k] = v.replace(/^"(.*)"$/, "$1");
}

interface ItemForSweep {
  id: string;
  ticket_number: number | null;
  title: string;
  description: string | null;
  priority: string;
  pathway: string;
  status: string;
  source_type: string | null;
  created_at: string;
  linked_sources: unknown[] | null;
}

interface Reassignment {
  id: string;
  new_priority: string;
  rationale: string;
}

async function main() {
  const userId = process.argv[2];
  const dryRun = process.argv.includes("--dry-run");
  if (!userId) {
    console.error("usage: tsx scripts/sweep-priorities.ts <user-id> [--dry-run]");
    process.exit(2);
  }

  const { createSupabaseServiceClient } = await import("../src/lib/supabase/server");
  const { trackedCreate } = await import("../src/lib/anthropic/tracked");
  const { MODELS } = await import("../src/lib/anthropic/client");

  const sb = createSupabaseServiceClient();
  const { data: items, error } = await sb
    .from("s2d_items")
    .select(
      "id, ticket_number, title, description, priority, pathway, status, source_type, created_at, linked_sources"
    )
    .eq("user_id", userId)
    .neq("status", "done")
    .in("priority", ["urgent", "high"]);
  if (error) throw error;
  if (!items || items.length === 0) {
    console.log("No urgent or high items to sweep.");
    return;
  }

  console.log(`Loaded ${items.length} urgent/high items for review.`);

  // Single batched call. Keep input compact — title, short description,
  // linked count, age in days. The LLM only emits {id, priority, rationale}.
  const payload = (items as ItemForSweep[]).map((it) => ({
    id: it.id,
    ticket: it.ticket_number ? `MASH-${it.ticket_number}` : it.id.slice(0, 6),
    title: it.title,
    description: (it.description ?? "").slice(0, 400),
    current_priority: it.priority,
    pathway: it.pathway,
    status: it.status,
    source: it.source_type,
    linked_sources_count: Array.isArray(it.linked_sources) ? it.linked_sources.length : 0,
    age_days: Math.round((Date.now() - new Date(it.created_at).getTime()) / 86400000),
  }));

  const system = `You are recalibrating priority levels on Sidd's task board. The previous triage was over-permissive — too many items got marked urgent/high. Be PARSIMONIOUS.

Calibration:
- urgent (action TODAY): only when at least one is true — explicit hard deadline today/missed, a paying customer is blocked right now, money actively bleeding, or an exec is waiting on a specific reply with same-day expectation stated. "Exec is involved" alone does NOT qualify. Most portco emails CC an exec — that's the default state, not urgency.
- high (this week): real this-week deadline, customer-impacting bug being prioritized, decision a teammate is blocked on, recurring signal hitting from multiple sources (linked_sources_count >= 3 is a real recurrence signal).
- medium (this sprint — DEFAULT): the honest answer for most things.
- low: nice-to-have / someday.

Heuristic: if you keep more than ~1 in 4 items at urgent or high after recalibration, you're still miscalibrated.

For each item, decide its new priority. Return STRICT JSON only:
{ "reassignments": [{ "id": "...", "new_priority": "urgent|high|medium|low", "rationale": "1 sentence — what changed your mind" }, ...] }
Only include items where new_priority differs from current_priority. No prose outside the JSON.`;

  const user = `Items to recalibrate (${payload.length} total):\n\n${JSON.stringify(payload, null, 2)}\n\nReturn the JSON.`;

  console.log("Calling LLM…");
  const resp = await trackedCreate(
    {
      model: MODELS.secondary,
      max_tokens: 8000,
      system,
      messages: [{ role: "user", content: user }],
    },
    "sweep_priorities",
    userId
  );
  const text = resp.content
    .filter((c) => c.type === "text")
    .map((c) => (c as { type: "text"; text: string }).text)
    .join("");

  let parsed: { reassignments?: Reassignment[] };
  try {
    // Tolerate fenced output even though we asked for none.
    const cleaned = text.replace(/^```(?:json)?\n?|\n?```$/g, "").trim();
    parsed = JSON.parse(cleaned);
  } catch {
    console.error("Failed to parse LLM JSON. Raw:\n", text);
    process.exit(1);
  }

  const reassignments = parsed.reassignments ?? [];
  if (reassignments.length === 0) {
    console.log("LLM proposed no changes. (Current state already calibrated.)");
    return;
  }

  // Summary
  const itemById = new Map(items.map((it) => [it.id, it]));
  const counts = { urgent: 0, high: 0, medium: 0, low: 0 };
  for (const r of reassignments) {
    if (r.new_priority in counts) counts[r.new_priority as keyof typeof counts]++;
  }
  console.log(`\nProposed reassignments: ${reassignments.length}`);
  console.log("  → urgent:", counts.urgent, "→ high:", counts.high, "→ medium:", counts.medium, "→ low:", counts.low);
  console.log("");
  for (const r of reassignments.slice(0, 30)) {
    const it = itemById.get(r.id);
    if (!it) continue;
    const ticket = it.ticket_number ? `MASH-${it.ticket_number}` : r.id.slice(0, 6);
    console.log(
      `  ${ticket.padEnd(9)} ${(it.priority + " → " + r.new_priority).padEnd(20)} ${it.title.slice(0, 60)}`
    );
    console.log(`            ${r.rationale.slice(0, 110)}`);
  }
  if (reassignments.length > 30) console.log(`  …(${reassignments.length - 30} more)`);

  if (dryRun) {
    console.log("\n--dry-run: not writing.");
    return;
  }

  console.log("\nWriting…");
  let written = 0;
  for (const r of reassignments) {
    if (!["urgent", "high", "medium", "low"].includes(r.new_priority)) continue;
    const { error } = await sb
      .from("s2d_items")
      .update({ priority: r.new_priority })
      .eq("id", r.id)
      .eq("user_id", userId);
    if (error) {
      console.error(`  failed ${r.id}: ${error.message}`);
      continue;
    }
    written++;
  }
  console.log(`Done. ${written}/${reassignments.length} updates applied.`);
}

void main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("FAIL:", e);
    process.exit(1);
  });
