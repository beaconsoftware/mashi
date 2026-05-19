/**
 * Dry-run: count how many calendar-backed S2D items would be auto-closed
 * by reconcileCalendarPastEvents. No writes.
 *
 *   pnpm tsx scripts/dry-run-past-cal-events.ts <user-id>
 *
 * Reads from .env.local. For prod creds, source a prod env first.
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
    console.error("usage: tsx scripts/dry-run-past-cal-events.ts <user-id>");
    process.exit(2);
  }

  const { createSupabaseServiceClient } = await import("../src/lib/supabase/server");
  const sb = createSupabaseServiceClient();

  const { data: items } = await sb
    .from("s2d_items")
    .select("id, ticket_number, title, source_thread_id, pathway, priority")
    .eq("user_id", userId)
    .eq("source_type", "calendar")
    .neq("status", "done");
  if (!items?.length) {
    console.log("No open calendar-sourced items.");
    return;
  }

  const externalIds = items
    .map((i) => i.source_thread_id)
    .filter((s): s is string => !!s);

  const { data: events } = await sb
    .from("calendar_events")
    .select("external_id, end_at, title")
    .eq("user_id", userId)
    .in("external_id", externalIds);

  const endByExternalId = new Map<string, { end_at: number; title: string | null }>();
  for (const e of events ?? []) {
    if (e.end_at)
      endByExternalId.set(e.external_id, {
        end_at: new Date(e.end_at).getTime(),
        title: e.title ?? null,
      });
  }

  const nowMs = Date.now();
  const stale: typeof items = [];
  for (const it of items) {
    if (!it.source_thread_id) continue;
    const e = endByExternalId.get(it.source_thread_id);
    if (!e) continue;
    if (e.end_at < nowMs) stale.push(it);
  }

  console.log(`Open calendar-sourced items: ${items.length}`);
  console.log(`Past-event items that WOULD be closed: ${stale.length}`);
  console.log("");
  for (const it of stale.slice(0, 40)) {
    const ticket = it.ticket_number ? `MASH-${it.ticket_number}` : it.id.slice(0, 6);
    const meta = it.source_thread_id ? endByExternalId.get(it.source_thread_id) : null;
    const hoursAgo = meta ? Math.round((nowMs - meta.end_at) / 3_600_000) : null;
    const ageLabel =
      hoursAgo == null ? "?" : hoursAgo < 24 ? `${hoursAgo}h` : `${Math.round(hoursAgo / 24)}d`;
    console.log(
      `  ${ticket.padEnd(9)} ${(it.pathway || "").padEnd(18)} ended ${ageLabel.padEnd(6)} — ${it.title.slice(0, 70)}`
    );
  }
  if (stale.length > 40) console.log(`  …(${stale.length - 40} more)`);
}

void main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("FAIL:", e);
    process.exit(1);
  });
