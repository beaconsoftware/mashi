// One-shot migration of Sidd's local data → hosted Supabase production.
// Reads rows owned by his LOCAL user_id, rewrites user_id to his PROD
// user_id, upserts into prod. Matt's data has a different user_id and
// is never touched.
//
// FK order matters: insert parents before children. Each table uses
// ON CONFLICT (id) DO NOTHING so re-runs are idempotent.

import { createClient } from "@supabase/supabase-js";
import process from "node:process";

const LOCAL_URL = "http://127.0.0.1:54321";
const LOCAL_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PROD_URL = "https://akpbzaivscqvaoapkdwd.supabase.co";
const PROD_SERVICE = process.env.PROD_SERVICE_KEY;
const LOCAL_USER = "ad487eca-56cb-4e08-b47c-b2ca3649b572";
const PROD_USER = "94bcc978-6b26-4c34-b3e1-231372c330cd";

if (!LOCAL_SERVICE || !PROD_SERVICE) {
  console.error("missing SUPABASE_SERVICE_ROLE_KEY or PROD_SERVICE_KEY env");
  process.exit(1);
}

const local = createClient(LOCAL_URL, LOCAL_SERVICE, { auth: { persistSession: false } });
const prod = createClient(PROD_URL, PROD_SERVICE, { auth: { persistSession: false } });

// Strict parent-before-child order. Anything not in this list is intentionally
// excluded (triage_runs / ai_usage_log / chat_* / memories / embeddings /
// notifications / briefings / follow_ups / sprint_sessions — all transient
// or telemetry, not worth migrating).
const TABLES = [
  "companies",
  "linear_orgs",
  "connected_accounts",
  "meetings",
  "action_items",         // refs meetings(source_meeting_id)
  "messages",             // refs connected_accounts
  "calendar_events",      // refs connected_accounts
  "linear_issues",        // refs linear_orgs, connected_accounts
  "s2d_items",            // refs companies + linked_calendar_event_id + linked_meeting_id
  "drafts",               // refs s2d_items
];

function remap(row) {
  return { ...row, user_id: PROD_USER };
}

// Paginate over Supabase default 1000-row limit
async function readAll(client, table, userId) {
  const PAGE = 1000;
  let from = 0;
  const out = [];
  for (;;) {
    const { data, error } = await client
      .from(table)
      .select("*")
      .eq("user_id", userId)
      .range(from, from + PAGE - 1);
    if (error) {
      console.error(`${table}: read page ${from} failed —`, error.message);
      return { rows: out, err: error.message };
    }
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return { rows: out, err: null };
}

// Tables where the unique constraint on external_id was changed in
// migration 013 to be (user_id, external_id). Use that composite as the
// conflict target so dedup is per-user, not global. Pre-filter logic is
// effectively a no-op now because cross-tenant collisions are gone, but
// we keep it for symmetry with how Sidd's own local data dedups.
const UNIQUE_COL = {
  meetings: "user_id,external_id",
  calendar_events: "user_id,external_id",
  linear_issues: "user_id,external_id",
  messages: "user_id,external_id",
};

async function migrate(table) {
  const { rows: raw } = await readAll(local, table, LOCAL_USER);
  if (raw.length === 0) {
    console.log(`${table}: 0 rows`);
    return { table, read: 0, written: 0, skipped: 0 };
  }
  let rows = raw.map(remap);

  // s2d_items: drop ticket_number so prod's sequence assigns fresh values
  // (prevents collisions with Matt's ticket numbers).
  if (table === "s2d_items") {
    rows = rows.map((r) => {
      const { ticket_number, ...rest } = r;
      void ticket_number;
      return rest;
    });
  }

  // After migration 013, external_id uniqueness is scoped per-user, so we
  // no longer need a pre-filter against cross-tenant collisions. The
  // upsert's onConflict target (composite when set) handles dedup against
  // our own prior inserts.
  const uniqueCol = UNIQUE_COL[table];

  const CHUNK = 200; // smaller to keep IN(...) URLs under server limits
  let written = 0;
  let firstErr = null;
  // For tables with a global-unique external_id, target THAT in onConflict
  // so Postgres skips dupes server-side regardless of what the pre-filter
  // missed. Otherwise the PK (id) is the right conflict target.
  const conflictCol = uniqueCol ?? "id";
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error: upErr, count } = await prod
      .from(table)
      .upsert(chunk, { onConflict: conflictCol, ignoreDuplicates: true, count: "exact" });
    if (upErr) {
      if (!firstErr) firstErr = upErr.message;
      console.error(`${table}: chunk ${i}..${i + chunk.length} failed —`, upErr.message);
      continue;
    }
    written += count ?? chunk.length;
  }
  console.log(`${table}: read=${raw.length}, written=${written}${firstErr ? " (with errors)" : " ✓"}`);
  return { table, read: raw.length, written, skipped: raw.length - written, err: firstErr };
}

// user_profile gets UPDATED, not upserted, because prod's row was auto-
// created by the trigger with auth.users.id as its primary key.
async function migrateUserProfile() {
  const { data } = await local
    .from("user_profile")
    .select("communication_style, name, onboarding_step, onboarded_at, onboarding_cleanup_ran_at")
    .eq("user_id", LOCAL_USER)
    .maybeSingle();
  if (!data) {
    console.log("user_profile: nothing to migrate");
    return;
  }
  const { error } = await prod
    .from("user_profile")
    .update({
      communication_style: data.communication_style,
      // Keep prod's name/email as-is; only carry over style + onboarding state
      onboarding_step: 6, // skip the wizard
      onboarded_at: data.onboarded_at ?? new Date().toISOString(),
      onboarding_cleanup_ran_at: data.onboarding_cleanup_ran_at ?? new Date().toISOString(),
    })
    .eq("user_id", PROD_USER);
  if (error) {
    console.error("user_profile: update failed —", error.message);
  } else {
    console.log("user_profile: updated ✓ (style profile + marked onboarded)");
  }
}

// ────────────────────────────────────────────────────────────────────

console.log("==========================================");
console.log("DRY-RUN COUNTS (local → prod)");
console.log("==========================================");
for (const t of TABLES) {
  const { count } = await local
    .from(t)
    .select("*", { count: "exact", head: true })
    .eq("user_id", LOCAL_USER);
  console.log(`  ${t}: ${count ?? 0} rows`);
}

console.log("\n==========================================");
console.log("MIGRATING (matt's rows untouched)");
console.log("==========================================");

const results = [];
for (const t of TABLES) {
  results.push(await migrate(t));
}
await migrateUserProfile();

console.log("\n==========================================");
console.log("POST-MIGRATION COUNTS in prod (your user)");
console.log("==========================================");
for (const t of TABLES) {
  const { count } = await prod
    .from(t)
    .select("*", { count: "exact", head: true })
    .eq("user_id", PROD_USER);
  console.log(`  ${t}: ${count ?? 0} rows`);
}

// Sanity check Matt is untouched
const { count: mattS2D } = await prod
  .from("s2d_items")
  .select("*", { count: "exact", head: true })
  .eq("user_id", "fd19cc50-32de-47d6-9cfe-7f337f72071e");
console.log(`\nMatt's s2d_items count (should be unchanged): ${mattS2D ?? 0}`);
