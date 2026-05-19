/**
 * Dry-run: count + list "Prep for X" items that would be auto-closed
 * because their referenced calendar meeting has ended.
 *
 *   pnpm tsx scripts/dry-run-prep-past.ts <user-id>
 *
 * Mirrors reconcilePastPrepItems exactly so you see the same set.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

for (const line of readFileSync(resolve(process.cwd(), ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
  if (!m) continue;
  const [, k, v] = m;
  if (!process.env[k]) process.env[k] = v.replace(/^"(.*)"$/, "$1");
}

async function main() {
  const userId = process.argv[2];
  if (!userId) {
    console.error("usage: tsx scripts/dry-run-prep-past.ts <user-id>");
    process.exit(2);
  }
  const { createSupabaseServiceClient } = await import("../src/lib/supabase/server");
  const sb = createSupabaseServiceClient();

  const { data: items } = await sb
    .from("s2d_items")
    .select(
      "id, ticket_number, title, source_type, source_thread_id, linked_sources, pathway"
    )
    .eq("user_id", userId)
    .neq("status", "done")
    .ilike("title", "prep%");
  if (!items?.length) {
    console.log("No open prep items.");
    return;
  }
  console.log(`Open prep items: ${items.length}`);

  type Cand = {
    id: string;
    ticket: string;
    title: string;
    pathway: string;
    eventExternalIds: string[];
  };
  const candidates: Cand[] = [];
  const unlinked: typeof items = [];
  for (const it of items) {
    const eventExternalIds: string[] = [];
    if (it.source_type === "calendar" && it.source_thread_id) {
      eventExternalIds.push(it.source_thread_id);
    }
    const links = Array.isArray(it.linked_sources) ? it.linked_sources : [];
    for (const ls of links) {
      const link = ls as { source_type?: string; source_thread_id?: string };
      if (link.source_type === "calendar" && link.source_thread_id) {
        eventExternalIds.push(link.source_thread_id);
      }
    }
    if (eventExternalIds.length === 0) {
      unlinked.push(it);
    } else {
      candidates.push({
        id: it.id,
        ticket: it.ticket_number ? `MASH-${it.ticket_number}` : it.id.slice(0, 6),
        title: it.title,
        pathway: it.pathway,
        eventExternalIds,
      });
    }
  }
  console.log(`  with calendar linkage:    ${candidates.length}`);
  console.log(`  without calendar linkage: ${unlinked.length}`);

  if (candidates.length === 0) return;
  const allExt = Array.from(new Set(candidates.flatMap((c) => c.eventExternalIds)));
  const { data: events } = await sb
    .from("calendar_events")
    .select("external_id, end_at, title")
    .eq("user_id", userId)
    .in("external_id", allExt);
  const endByExt = new Map<string, { end_at: number; title: string | null }>();
  for (const e of events ?? []) {
    if (e.end_at)
      endByExt.set(e.external_id, {
        end_at: new Date(e.end_at).getTime(),
        title: e.title ?? null,
      });
  }

  const nowMs = Date.now();
  const wouldClose: Array<Cand & { eventTitle: string | null; ageHours: number }> = [];
  for (const c of candidates) {
    const known = c.eventExternalIds
      .map((x) => endByExt.get(x))
      .filter((v): v is { end_at: number; title: string | null } => v != null);
    if (known.length === 0) continue;
    if (!known.every((e) => e.end_at < nowMs)) continue;
    const latest = known.reduce((a, b) => (a.end_at > b.end_at ? a : b));
    wouldClose.push({
      ...c,
      eventTitle: latest.title,
      ageHours: Math.round((nowMs - latest.end_at) / 3_600_000),
    });
  }

  console.log(`\nWould auto-close: ${wouldClose.length}\n`);
  for (const w of wouldClose.slice(0, 50)) {
    const age =
      w.ageHours < 24 ? `${w.ageHours}h` : `${Math.round(w.ageHours / 24)}d`;
    console.log(
      `  ${w.ticket.padEnd(9)} ${w.pathway.padEnd(18)} (${age.padEnd(4)} ago) ${w.title.slice(0, 80)}`
    );
  }
  if (wouldClose.length > 50) console.log(`  …(${wouldClose.length - 50} more)`);

  if (unlinked.length > 0) {
    console.log(
      `\n${unlinked.length} prep items have NO calendar linkage — those rely on the LLM ai-staleness pass.`
    );
    for (const u of unlinked.slice(0, 10)) {
      const t = u.ticket_number ? `MASH-${u.ticket_number}` : u.id.slice(0, 6);
      console.log(`  ${t} ${u.title.slice(0, 80)}`);
    }
    if (unlinked.length > 10) console.log(`  …(${unlinked.length - 10} more)`);
  }
}

void main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("FAIL:", e);
    process.exit(1);
  });
