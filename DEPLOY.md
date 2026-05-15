# Pre-production deploy runbook

Steps to take Mashi from single-user (Sidd-only) to multi-tenant beta for other
product leads. Follow in order — skipping or reordering can corrupt data or
brick syncs.

**Status**: Migration 012 applied to local Supabase (`supabase_db_mashi`),
947 s2d_items + 3 companies attributed, RLS policies verified. The migration
file itself was hardened to handle autocommit (uses inline subqueries
instead of session-scoped settings) — safe to push to fresh DBs now.

---

## 0. Pre-flight

- [ ] Confirm `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_URL` are set in the
      deployment environment.
- [ ] Confirm Google OAuth client allows the deployment origin.
- [ ] Take a Supabase backup (Dashboard → Database → Backups → "Create").

## 1. Verify the service-role refactor landed

Every service-role insert/upsert now writes `user_id` explicitly. Confirm:

```bash
grep -rE "\.insert\(|\.upsert\(" src/lib/sync/ src/lib/triage/orchestrator.ts
```

Every hit should include `user_id:` in the row, OR be writing to a table that
intentionally allows null user_id (currently only `ai_usage_log`).

If you see a service-role insert without `user_id`, FIX IT BEFORE step 2. The
NOT NULL constraint added in migration 012 will reject those writes.

## 2. Apply migration 012 to staging

```bash
# Locally:
supabase db push --db-url "$STAGING_DB_URL"
# Or via Dashboard SQL editor: paste supabase/migrations/012_multi_tenant_rls.sql
```

The migration:

- Adds `user_id` to 18 data tables
- Backfills existing rows to the oldest user in `auth.users` (= Sidd in
  staging if you've only logged in as yourself)
- Sets `NOT NULL` + `DEFAULT auth.uid()` so user-scoped writes auto-attach
- Replaces "any-authed" RLS policies with `auth.uid() = user_id`
- Adds `onboarding_step`, `onboarded_at`, `onboarding_cleanup_ran_at` to
  `user_profile`
- Marks the primordial user as already-onboarded (skips wizard)
- Adds `signup_allowlist` table seeded with `beaconsoftware.com`
- Adds triggers on `auth.users` for allowlist enforcement + auto-profile
  creation

## 3. Reload PostgREST schema cache

Without this, the new columns won't show up in API requests (you'll see
"Could not find the X column" errors).

In Supabase SQL editor:

```sql
NOTIFY pgrst, 'reload schema';
```

Or restart the Supabase project from Dashboard → Settings → API.

## 4. Smoke test staging

1. Log in as the primordial user → should land directly on /cockpit (skips
   onboarding because the migration stamped you as already onboarded)
2. Trigger a sync from the top-bar chip — confirm new rows appear with your
   `user_id`
3. Open SQL editor: `SELECT COUNT(*) FROM s2d_items WHERE user_id IS NULL` →
   should return 0
4. Sign out, sign up with a different `@beaconsoftware.com` Google account →
   should land on /onboard/welcome
5. As that new user, query `SELECT * FROM s2d_items` from the API — confirm
   you see zero rows (RLS isolation working)
6. Try signing up with a non-allowlisted domain → trigger should reject

## 5. Production migration

Same as staging, but with `$PROD_DB_URL`. Run during a low-traffic window.
Reload PostgREST schema cache (step 3) immediately after.

## 6. Deploy code

The code already tolerates a not-yet-applied migration (the dashboard guard
falls back to "let them in" if `onboarding_step` column doesn't exist), so
the order of code-vs-migration is forgiving. But ideally:

1. Apply migration first
2. Reload schema cache
3. Deploy code

## 7. Invite first external user

1. Add their email domain to `signup_allowlist` if it's not already there:
   ```sql
   INSERT INTO signup_allowlist (domain, note) VALUES
     ('theiremail.com', 'Why they are allowed');
   ```
2. Send them the URL. They sign up with Google. Trigger creates their
   `user_profile`, sets `onboarding_step = 0`.
3. They run through /onboard/welcome → /tour. Step 5 runs the cleanup pass.

---

## CI/CD

### GitHub Actions
[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every PR and push
to `main`. Two jobs:

- **verify** — `pnpm exec tsc --noEmit && pnpm lint`. Fast (~1 min). Gates merge.
- **build** — `pnpm build` with placeholder env vars. Catches build-time
  regressions that lint doesn't see. Runs after verify passes.

Concurrency group cancels stale runs when you push twice quickly.

### Vercel
[`vercel.json`](vercel.json) configures:
- pnpm install + build commands
- `iad1` region (closest to your East-coast users; change if your Supabase is elsewhere)
- Function-level `maxDuration` overrides for the long-running endpoints
  (reconcile/consolidate/bundle 120s, onboard cleanup + sync 300s — these
  exceed Vercel's default 10s/60s ceilings)

**Status**: Vercel project `beacon-sw/mashi` is linked to this directory.
Production + Development env vars are populated from `.env.local`. Two
manual one-time steps remain:

1. **Connect GitHub login to Vercel** — visit
   [vercel.com/account/login-connections](https://vercel.com/account/login-connections)
   and add the GitHub connection. Without this, Vercel can't auto-deploy
   from `sidd-beacon/mashi` pushes. After it's set, run `vercel git connect`
   from this dir.
2. **Copy env vars to Preview scope** — Vercel CLI requires an explicit
   git-branch argument for Preview env, which means scripting it would
   silo every var to a single branch. Cleaner to use the Dashboard:
   Project Settings → Environment Variables → for each var, click "Edit"
   and tick the Preview checkbox.

Daily flow after that:
- PR opens → preview URL with the Preview env scope
- Merge to `main` → production deploy

### Local pre-commit
There is **no Husky / lint-staged**. The reason: this project lives inside
`~/.git` (your home directory is the actual repo). A Husky pre-commit
hook would fire on every commit anywhere in your home directory, not just
on Mashi changes. Use `pnpm verify` manually before pushing instead — same
checks the CI runs.

### Local development quality gate
```bash
pnpm verify   # typecheck + lint
pnpm build    # full Next.js build (slowest; do before pushing big PRs)
```

### Migrations in CI
Not automated yet — apply manually via `supabase db push` or Dashboard SQL
editor. When you have ≥3 active users this becomes a real footgun; add a
manual-approval GitHub workflow then. For now the friction is intentional.

---

## Known pre-production gaps (file as follow-ups before scaling)

- **AI usage logging is mostly per-user-attributed.** The high-traffic paths
  (triage orchestrator, chat, item-chat, copilot suggest) now pass `userId`
  through `trackedCreate` / `streamClaudeText`, so per-user cost is queryable.
  Remaining unattributed: cross-user system jobs (consolidate, propagate,
  ai-staleness, bundle-meetings) — those intentionally write `user_id =
  NULL` because they span multiple users' work. A few minor endpoints
  (`/api/sprint/build`, `/api/sprint/rank`, `/api/s2d/justify`,
  `/api/s2d/enrich`, `/api/style/*`) still don't thread userId — fix when
  you wire per-user billing.
- **No webhook-based realtime sync.** Everything polls. Documented in the
  TopBar sync chip tooltip + the onboarding sync step. Roadmap item.
- **Service-role still bypasses RLS for cron and AI passes.** That's expected
  — they need cross-user access — but audit any new service-role code paths
  to make sure they scope by `user_id` correctly.
- **No admin UI for `signup_allowlist`.** Edit via SQL for now.
- **No quota / rate limits per user.** Add before going past ~5 beta users so
  one user can't blow your Anthropic budget.

---

## Rollback

The migration is mostly additive. If something goes wrong:

```sql
-- Disable the allowlist trigger (lets you sign up if it's misconfigured)
DROP TRIGGER IF EXISTS enforce_signup_allowlist_trigger ON auth.users;

-- Restore the permissive policy on a table if RLS broke a feature
DROP POLICY "own rows" ON <table>;
CREATE POLICY "authed full access" ON <table>
  FOR ALL USING (auth.role() = 'authenticated');
```

You CANNOT easily drop the `user_id` columns once data has been written
referencing them. If you need to roll all the way back, restore from the
step-0 backup.
