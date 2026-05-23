/**
 * One-shot seed for the Playwright visual-regression test user.
 *
 * What it does:
 *   1. Creates a dedicated Supabase user (`ci-visual@beaconsoftware.com`
 *      by default), or reuses the existing one if it's already there.
 *   2. Marks the user_profile as fully onboarded so middleware lets the
 *      test session straight into /cockpit.
 *   3. Seeds a curated fixture set on the s2d_items table — one item
 *      per status (backlog/todo/in_progress/in_queue/done) so the
 *      board renders all five columns with content for the screenshot
 *      diff.
 *   4. Prints the user_id + email so you can paste them into GitHub
 *      Actions repo secrets as PLAYWRIGHT_TEST_USER_ID +
 *      PLAYWRIGHT_TEST_USER_EMAIL.
 *
 * Usage:
 *   pnpm tsx scripts/seed-ci-test-user.ts
 *
 *   # Or against prod (pulls envvars from a separate file):
 *   env $(grep -v '^#' .env.production | xargs) pnpm tsx scripts/seed-ci-test-user.ts
 *
 * Reads SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL from env
 * (or .env.local). Idempotent — safe to re-run.
 *
 * Note: this script does NOT seed companies, notes, meetings, linear
 * issues, calendar events, etc. Empty states are fine for those pages
 * — the screenshots primarily validate chrome / shell / primitive
 * layout. If a future spec needs richer data, extend this script
 * rather than seeding ad-hoc from the test files.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

// Load .env.local on top of process.env (process.env wins, so CI works too).
const envPath = resolve(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    const [, k, v] = m;
    if (!process.env[k]) process.env[k] = v.replace(/^"(.*)"$/, "$1");
  }
}

const TEST_EMAIL = process.env.PLAYWRIGHT_TEST_USER_EMAIL || "ci-visual@beaconsoftware.com";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — set in .env.local or env."
  );
  process.exit(2);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function ensureUser(): Promise<string> {
  // Admin listUsers is paginated; we filter by email manually to avoid
  // depending on the exact admin search shape (which has shifted across
  // Supabase versions).
  let page = 1;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    const hit = data.users.find((u) => u.email?.toLowerCase() === TEST_EMAIL.toLowerCase());
    if (hit) {
      console.log(`✓ Existing test user: ${hit.id}`);
      return hit.id;
    }
    if (data.users.length < 200) break;
    page += 1;
  }

  const { data, error } = await admin.auth.admin.createUser({
    email: TEST_EMAIL,
    email_confirm: true,
    user_metadata: { full_name: "CI Visual Test", purpose: "playwright-baselines" },
  });
  if (error) throw new Error(`createUser failed: ${error.message}`);
  if (!data.user) throw new Error("createUser returned no user");
  console.log(`✓ Created test user: ${data.user.id}`);
  return data.user.id;
}

async function ensureOnboarded(userId: string) {
  // The create_user_profile_trigger on auth.users INSERT auto-creates
  // a user_profile row at onboarding_step=0. We just UPDATE the row
  // identified by user_id (the schema's primary tenancy column — `id`
  // is an internal UUID, see 012_multi_tenant_rls.sql).
  const { error } = await admin
    .from("user_profile")
    .update({
      name: "CI Visual Test",
      email: TEST_EMAIL,
      onboarding_step: 6,
      onboarded_at: new Date().toISOString(),
      onboarding_cleanup_ran_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
  if (error) throw new Error(`user_profile update failed: ${error.message}`);
  console.log("✓ user_profile marked onboarded");
}

const SEED_ITEMS: Array<{
  title: string;
  status: "backlog" | "todo" | "in_progress" | "in_queue" | "done";
  pathway: string;
  priority: "urgent" | "high" | "medium" | "low";
  est_minutes: number;
}> = [
  { title: "Review Q3 fundraising deck", status: "backlog", pathway: "heads_down", priority: "high", est_minutes: 45 },
  { title: "Draft reply to Acme procurement", status: "todo", pathway: "drafted_response", priority: "high", est_minutes: 15 },
  { title: "Migrate sprint runner tests", status: "in_progress", pathway: "heads_down", priority: "medium", est_minutes: 90 },
  { title: "Follow up: portco intro from Vivek", status: "in_queue", pathway: "delegated", priority: "low", est_minutes: 10 },
  { title: "Send weekly recap email", status: "done", pathway: "quick_reply", priority: "low", est_minutes: 5 },
];

async function ensureFixtureItems(userId: string) {
  // Idempotent: only insert items whose title doesn't already exist for
  // this user. We don't dedupe by status because we want exactly one
  // visible item per column.
  const { data: existing, error: selErr } = await admin
    .from("s2d_items")
    .select("title")
    .eq("user_id", userId);
  if (selErr) throw new Error(`s2d_items select failed: ${selErr.message}`);
  const have = new Set((existing ?? []).map((r) => r.title));

  const missing = SEED_ITEMS.filter((it) => !have.has(it.title)).map((it) => ({
    ...it,
    user_id: userId,
    description: null as string | null,
    energy: "medium" as const,
    source_type: "manual" as const,
    done_at: it.status === "done" ? new Date().toISOString() : null,
  }));

  if (missing.length === 0) {
    console.log("✓ Fixture s2d_items already present");
    return;
  }

  const { error: insErr } = await admin.from("s2d_items").insert(missing);
  if (insErr) throw new Error(`s2d_items insert failed: ${insErr.message}`);
  console.log(`✓ Seeded ${missing.length} s2d_items`);
}

async function main() {
  console.log(`Target Supabase: ${SUPABASE_URL}`);
  console.log(`Test user email: ${TEST_EMAIL}`);
  const userId = await ensureUser();
  await ensureOnboarded(userId);
  await ensureFixtureItems(userId);
  console.log("\nDone. Add these to GitHub Actions repo secrets:");
  console.log(`  PLAYWRIGHT_TEST_USER_ID = ${userId}`);
  console.log(`  PLAYWRIGHT_TEST_USER_EMAIL = ${TEST_EMAIL}`);
  console.log("  (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY:");
  console.log("   add from your existing Vercel env)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
