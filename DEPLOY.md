# Mashi deployment runbook

Centralized doc for everything pipeline-related — what's deployed, where, how
to add new users, how to bring up a fresh environment, and the gotchas we hit
on the way to first colleague signing in.

---

## Current production state

| Layer | Where | Notes |
|---|---|---|
| Code repo | [github.com/sidd-beacon/mashi](https://github.com/sidd-beacon/mashi) | Private. Owner: `sidd-beacon`. |
| CI | GitHub Actions (`.github/workflows/ci.yml`) | Typecheck + lint + build on every PR/push. |
| App hosting | Vercel project `beacon-sw/mashi` | Auto-deploys `main` → production via Vercel GitHub App. |
| Stable URL | `https://mashi-beacon-sw.vercel.app` | Gated by org-level Vercel Deployment Protection (see workaround below). |
| Hosted DB | Supabase project `mashi` (ref `akpbzaivscqvaoapkdwd`, region `us-east-1`) | Migrations 001–012 applied. RLS verified. |
| Local dev DB | Supabase Docker (`supabase_db_mashi`) | Mirrors production schema; full migration history. |
| Auth | Supabase Auth + Google OAuth | App is in Google "Testing" mode — each new user must be added as a Test User. |

## Inviting a new user

End-to-end checklist for adding `someone@theirorg.com`:

1. **Allowlist their email domain** if it's not already there:
   ```sql
   INSERT INTO public.signup_allowlist (domain, note) VALUES
     ('theirorg.com', 'Why they have access')
   ON CONFLICT (domain) DO NOTHING;
   ```
   Run via [Supabase SQL editor](https://supabase.com/dashboard/project/akpbzaivscqvaoapkdwd/sql/new).
2. **Add as Google OAuth Test User** at [console.cloud.google.com → APIs & Services → OAuth consent screen](https://console.cloud.google.com/apis/credentials/consent) → Test users → Add. *Without this they hit "Access blocked: app has not completed the Google verification process".*
3. **Give them access to the Vercel deploy** — one of:
   - Add to `beacon-sw` Vercel team (Members tier) — cleanest, pass through SSO automatically.
   - Send them a [Shareable Link](https://vercel.com/docs/security/deployment-protection/methods-to-bypass-deployment-protection/shareable-links) — bypasses SSO per-link, per-deployment.
   - Set up a custom domain in Deployment Protection Exceptions (one-time work, then anyone can hit it).
4. **Send them the URL**. They sign in with Google → land at `/onboard/welcome`. The onboarding wizard walks them through connections + first sync.

## Per-provider gotchas

These all bit us in production. Heads-up:

### Google OAuth (Gmail + Calendar + auth)

- **App is in "Testing" mode** — only Test Users can sign in. Add invitees explicitly. Cap is 100 users until you submit for verification.
- **Authorized redirect URIs must include all of**:
  ```
  https://akpbzaivscqvaoapkdwd.supabase.co/auth/v1/callback
  https://mashi-beacon-sw.vercel.app/auth/callback
  https://mashi-beacon-sw.vercel.app/api/connect/gmail/callback
  https://mashi-beacon-sw.vercel.app/api/connect/gcal/callback
  http://localhost:3456/api/connect/gmail/callback   (local dev)
  http://localhost:3456/api/connect/gcal/callback    (local dev)
  http://127.0.0.1:54321/auth/v1/callback            (local Supabase)
  ```
- **Authorized JavaScript origins**: `https://mashi-beacon-sw.vercel.app`

### Slack (in-app connector)

- App must have **Public Distribution activated** — otherwise only the original workspace (Beacon) can install. Activate in [api.slack.com → your app → Manage Distribution](https://api.slack.com/apps).
- The HTTPS pre-distribution check rejects `http://localhost` redirect URIs. Remove the localhost URL before activating; use ngrok if you ever need to test OAuth locally.
- Mashi uses User tokens (`xoxp-`), not Bot tokens. Bot Token Scopes section can stay empty.

### Linear (in-app connector)

- Uses per-user **personal API keys**, not OAuth. Settings location: each user clicks their avatar → **Preferences → Security & access → Personal API keys**.
- If a user can't see "Create API key", their workspace admin has restricted it. Fix: admin goes to **Workspace settings → Security & access → API key creation** and sets to `All members`. (The in-app dialog includes this exact text now.)

### Fireflies

- API key only, paste-and-go. No OAuth, no developer-side work. Each user grabs theirs from `app.fireflies.ai → Settings → Developer Settings`.

## Vercel Deployment Protection workaround

The `beacon-sw` Vercel team has org-level "Require Log In" enabled and only Owners can change it. The production URL returns 401 to non-team-members. Three workarounds documented in order of effort:

1. **Team Owner disables team-level Vercel Authentication** for the `mashi` project — cleanest, requires Owner permission Sidd doesn't have.
2. **Add a custom domain + put it in Deployment Protection Exceptions**. The custom domain is publicly accessible, the `.vercel.app` URL stays gated. Requires DNS control over a domain. Tried `mashi.beaconsoftware.com` but never set the DNS record; the path is in the script `scripts/post-domain-setup.sh` if revisited.
3. **Shareable Links** per-user — bypasses SSO via signed link. Not scalable but works for 1–5 invitees.

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

### Supabase migrations in CI
[`.github/workflows/migrate.yml`](.github/workflows/migrate.yml) auto-applies
Supabase migrations to production on every push to `main` that touches
`supabase/migrations/**`. Other pushes skip it (no-op).

What it does:
1. Installs the Supabase CLI (`supabase/setup-cli@v1`)
2. Links to project `akpbzaivscqvaoapkdwd`
3. Runs `supabase db push` — idempotent; only applies migration files not
   already recorded in `supabase_migrations.schema_migrations`
4. Issues `NOTIFY pgrst, 'reload schema'` so PostgREST picks up new
   columns/tables immediately (otherwise ~10 min cache lag)

Concurrency group `supabase-migrations-prod` queues runs so two pushes
can't race. The workflow fails loudly if either secret is missing or a
migration errors.

**Required GitHub Secrets** at
[`github.com/sidd-beacon/mashi/settings/secrets/actions`](https://github.com/sidd-beacon/mashi/settings/secrets/actions):

| Name | Value |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | Personal access token from [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens) — name it `mashi-ci`, save the value, paste here |
| `SUPABASE_DB_PASSWORD` | The DB password from project creation: `07asHiD+xLNFsfKr6ehw3DUjCHAQA/eQ` |

### Vercel: wait for CI before deploying
After the migration workflow exists, gate Vercel deploys on it so the
schema is always ready when the code that needs it lands:

1. Vercel Dashboard → `beacon-sw/mashi` → Project Settings → Git
2. Find **"Wait for CI to Pass before Deploying"** → toggle ON
3. Vercel will now hold each deploy until both `verify` and `apply` jobs
   pass on the corresponding commit

Without this toggle, Vercel can ship code that depends on a migration
before the migration finishes applying. The 500s last ~30 seconds but
look bad. With the toggle, you get correct ordering for free.

### Migrations: legacy manual path (still works)
You can always apply migrations by hand via `supabase db push --linked`
or by pasting SQL into the Dashboard editor. The CI workflow is just
the convenience layer. The `schema_migrations` table is the source of
truth; whichever path you use, Supabase tracks what's been applied.

### Older manual notes (kept for reference)
When you have ≥3 active users this becomes a real footgun; add a
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

## Thorough pre-production audit (as of last update)

Walking the entire path from "someone visits the live URL" to "they get a working board":

### ✅ Done

- GitHub repo private at [sidd-beacon/mashi](https://github.com/sidd-beacon/mashi)
- Vercel project `beacon-sw/mashi` linked, GitHub auto-deploy connected
- CI runs typecheck + lint + build on every PR + push to main
- Vercel `vercel.json` configures `maxDuration` per long endpoint
- Production deploy live (gated by Vercel deployment protection)
- Production stable alias `mashi-beacon-sw.vercel.app` set as `NEXT_PUBLIC_APP_URL`
- 15 secrets pushed to Vercel Production + Development scopes
- Local Supabase fully migrated through 012, 947 s2d_items + 3 companies
  attributed via RLS, primordial user marked already-onboarded
- Migration 012 hardened for both autocommit AND fresh-DB cases

### ✅ Resolved — hosted Supabase is live

Production now points at `https://akpbzaivscqvaoapkdwd.supabase.co`. Migrations 001–012 applied, RLS verified end-to-end with a simulated MAP user signup.

### ✅ Resolved — auth redirect lands at production URL

Supabase Auth `site_url` set to `https://mashi-beacon-sw.vercel.app` via Management API. Redirect allowlist: `https://mashi-beacon-sw.vercel.app/**`, `https://mashi-*-beacon-sw.vercel.app/**`, `http://localhost:3456/**`.

### ✅ Resolved — Google OAuth callbacks present

Authorized redirect URIs include the four needed for production (Supabase Auth + sign-in callback + gmail connect + gcal connect). Each new invitee gets added as a Test User in [OAuth consent screen](https://console.cloud.google.com/apis/credentials/consent) — Google's "Testing" mode requirement.

### ✅ Resolved — Slack distribution active

Production redirect URI added; Public Distribution activated. Beacon + MAP can install. User Token Scopes wired for `channels:history`, `channels:read`, `chat:write`, `groups:history`, `im:history`, `im:read`, `mpim:history`, `mpim:read`, `users:read`, `users:read.email`.

### ✅ Linear is API-key based, no developer-side OAuth needed

Each user creates a personal API key in **Preferences → Security & access → Personal API keys**. The connections-manager dialog in-app surfaces this path explicitly. If a user can't see "Personal API keys", their admin has restricted creation — they need to flip the workspace setting (also documented in-app).

### 🟢 Working, no action needed

- New-user flow (verified end-to-end against local DB on 2026-05-15):
  signup → allowlist check → auto-profile → redirect to `/onboard`
- `signup_allowlist` seeded with `beaconsoftware.com`
- The dashboard guard at `(dashboard)/layout.tsx` correctly redirects
  un-onboarded users to `/onboard`
- AI usage attribution wired for triage + chat + copilot

### 🔵 Nice-to-haves for after first colleague signs in

- **Custom domain**: `mashi.beaconsoftware.com` or similar via Vercel →
  Domains. Means stable URL + you don't depend on the `vercel.app` alias.
- **Error tracking**: Sentry or similar. Hobby Vercel logs disappear in 24h.
- **Per-user rate limits**: a malicious or buggy user can blow your
  Anthropic budget. Defer until you have 3+ users.
- **Transactional email**: Supabase's built-in email is rate-limited and
  unreliable. Wire Resend (env var already in `.env.example`) when you
  need confirmation / password-reset emails.
- **Webhook-based sync**: currently everything polls. Roadmap.

### Sanity-check checklist after applying production fixes

Before inviting your first colleague, in this order:

1. Visit `https://mashi-beacon-sw.vercel.app` — should hit sign-in page (not 401-Vercel-protection — toggle that off first in Project Settings)
2. Sign in with your own Google account → should land on `/onboard/welcome`
   (you'll be a new user in the hosted DB regardless of being primordial on local)
3. Walk through onboarding to step 6 → cockpit loads, no console errors
4. In a second browser / incognito, sign in with a different `@beaconsoftware.com` account
5. Verify in Supabase Dashboard → `s2d_items` shows two distinct `user_id` values
6. As either user, try to query the other user's `user_id` via the SQL editor
   with their session token — should return zero rows (RLS isolation working)

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
