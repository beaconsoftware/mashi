/**
 * One-shot backfill: populate s2d_items.source_url for items created
 * before this column was being set at triage-create time. Walks every
 * row with null source_url and pulls the URL from the source table:
 *
 *   - linear  → linear_issues.url
 *   - gmail   → mail.google.com/mail/u/0/#all/<thread_id>
 *   - slack   → slack.com/app_redirect?channel=<channel_id>
 *   - fireflies → app.fireflies.ai/view/<external_id>
 *   - calendar → calendar_events.meeting_url (best-effort)
 *
 * Run:
 *   pnpm tsx scripts/backfill-source-urls.ts <user-id> [--dry-run]
 *
 * --dry-run prints a per-source count of items that would be updated.
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
  const dryRun = process.argv.includes("--dry-run");
  if (!userId) {
    console.error("usage: tsx scripts/backfill-source-urls.ts <user-id> [--dry-run]");
    process.exit(2);
  }

  const { createSupabaseServiceClient } = await import("../src/lib/supabase/server");
  const sb = createSupabaseServiceClient();

  // Load every open + closed S2D item with no source_url and a source_thread_id
  // we can use to derive one.
  const { data: items } = await sb
    .from("s2d_items")
    .select("id, source_type, source_thread_id")
    .eq("user_id", userId)
    .is("source_url", null)
    .not("source_thread_id", "is", null);
  if (!items?.length) {
    console.log("No items to backfill.");
    return;
  }
  console.log(`Loaded ${items.length} items missing source_url.`);

  // Pre-fetch the per-source URL tables in one round trip each.
  // Linear → linear_issues.url
  const linearIds = items
    .filter((i) => i.source_type === "linear" && i.source_thread_id)
    .map((i) => i.source_thread_id!);
  const linearUrlByExtId = new Map<string, string>();
  if (linearIds.length > 0) {
    const { data: linRows } = await sb
      .from("linear_issues")
      .select("external_id, url")
      .eq("user_id", userId)
      .in("external_id", linearIds);
    for (const r of linRows ?? []) {
      if (r.url) linearUrlByExtId.set(r.external_id, r.url);
    }
  }

  // Calendar → calendar_events.meeting_url (best-effort Zoom/Meet link)
  const calIds = items
    .filter((i) => i.source_type === "calendar" && i.source_thread_id)
    .map((i) => i.source_thread_id!);
  const calUrlByExtId = new Map<string, string>();
  if (calIds.length > 0) {
    const { data: calRows } = await sb
      .from("calendar_events")
      .select("external_id, meeting_url")
      .eq("user_id", userId)
      .in("external_id", calIds);
    for (const r of calRows ?? []) {
      if (r.meeting_url) calUrlByExtId.set(r.external_id, r.meeting_url);
    }
  }

  // Per-item URL derivation.
  type Plan = { id: string; url: string; source_type: string };
  const planned: Plan[] = [];
  for (const it of items) {
    if (!it.source_thread_id || !it.source_type) continue;
    let url: string | null = null;
    switch (it.source_type) {
      case "linear":
        url = linearUrlByExtId.get(it.source_thread_id) ?? null;
        break;
      case "gmail":
        url = `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(it.source_thread_id)}`;
        break;
      case "slack": {
        // source_thread_id is "<channel>:<YYYY-MM-DD>"; pull channel id.
        const [channelId] = it.source_thread_id.split(":");
        url = channelId
          ? `https://slack.com/app_redirect?channel=${encodeURIComponent(channelId)}`
          : null;
        break;
      }
      case "fireflies":
        url = `https://app.fireflies.ai/view/${encodeURIComponent(it.source_thread_id)}`;
        break;
      case "calendar":
        url = calUrlByExtId.get(it.source_thread_id) ?? null;
        break;
    }
    if (url) planned.push({ id: it.id, url, source_type: it.source_type });
  }

  const bySource = planned.reduce<Record<string, number>>((m, p) => {
    m[p.source_type] = (m[p.source_type] ?? 0) + 1;
    return m;
  }, {});
  console.log("Planned updates by source:");
  for (const [src, n] of Object.entries(bySource)) console.log(`  ${src.padEnd(10)} ${n}`);
  console.log(`  total      ${planned.length}`);

  if (dryRun) {
    console.log("\n--dry-run: not writing.");
    return;
  }

  console.log("\nWriting…");
  let written = 0;
  for (const p of planned) {
    const { error } = await sb
      .from("s2d_items")
      .update({ source_url: p.url })
      .eq("id", p.id)
      .eq("user_id", userId);
    if (error) {
      console.error(`  failed ${p.id}: ${error.message}`);
      continue;
    }
    written++;
  }
  console.log(`Done. ${written}/${planned.length} updates applied.`);
}

void main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("FAIL:", e);
    process.exit(1);
  });
