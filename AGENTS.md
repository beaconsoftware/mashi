<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# Mashi engineering conventions

Centralized doc for code conventions, gotchas, and invariants. Read before
writing code or running migrations. Ops/infra guidance lives in
[`DEPLOY.md`](DEPLOY.md); this file is for the codebase.

## Stack

- **Next.js 16** (App Router, Turbopack dev server, React 19, React Compiler lints on).
- **pnpm** — never `npm install`; lockfile is `pnpm-lock.yaml`. CI uses `--frozen-lockfile`.
- **Supabase** for DB + Auth + Storage. Production is `akpbzaivscqvaoapkdwd.supabase.co`; local is Docker (`supabase status` to verify).
- **Anthropic SDK** for all LLM calls. Always route through `trackedCreate` / `trackedStream` in `src/lib/anthropic/tracked.ts` so usage gets logged.
- **GSAP** for animation, via `@gsap/react` `useGSAP` hook.
- **TanStack Query** for client data, **Zustand** for transient UI state.
- **dnd-kit** for drag-and-drop on the S2D board.

## Multi-tenancy invariants

Every data table has a `user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL DEFAULT auth.uid()`. RLS policy on every table is owner-only: `auth.uid() = user_id` for both `USING` and `WITH CHECK`.

**Hard rules**:

1. Every `INSERT` or `UPSERT` from a **service-role** code path (anywhere using `createSupabaseServiceClient`) must set `user_id` explicitly. The DB default of `auth.uid()` resolves to NULL under service-role and the `NOT NULL` will reject the write.
2. **Service-role bypasses RLS.** Audit every new service-role code path to confirm it scopes by `user_id`. Cross-user reads are intentional only for system jobs (consolidate, propagate, ai-staleness, bundle-meetings); everything else must filter by the current user.
3. Sync paths thread `conn.user_id` from `connected_accounts` into every child row (messages, meetings, calendar_events, linear_issues). See `src/lib/sync/*-sync.ts` for the pattern.

## Trigger function discipline

PG functions attached to `auth.users` triggers (or any function GoTrue might invoke) **must**:

```sql
CREATE OR REPLACE FUNCTION public.<name>()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp   -- mandatory
AS $$
BEGIN
  -- Bypass RLS if writing to a table with auth.uid()-based policy.
  -- auth.uid() is NULL inside trigger context, so WITH CHECK rejects.
  SET LOCAL row_security = off;

  INSERT INTO public.target_table (...)   -- always schema-qualify
  VALUES (...);
  RETURN NEW;
END;
$$;

GRANT EXECUTE ON FUNCTION public.<name>() TO supabase_auth_admin, anon, authenticated, service_role;
```

Skipping any of these = "Database error saving new user" surfaced from GoTrue with no detail. We hit this. Don't again.

## Migration patterns

- **Additive only.** Never drop columns; never rewrite history. Use new sequentially-numbered migrations. The CI workflow auto-applies on push to `main`, so a destructive migration ships the moment it lands.
- **Idempotent.** Use `IF NOT EXISTS`, `ON CONFLICT DO NOTHING`, `DROP TRIGGER IF EXISTS`. Migrations may be re-applied (the CI re-runs `supabase db push` on every push, even if no new migrations — it's a no-op when there's nothing new).
- **Robust to autocommit.** Don't rely on `set_config(..., true)` (transaction-local) — the runner may autocommit each statement. Inline subqueries against `auth.users` if you need a primordial user (`SELECT id FROM auth.users ORDER BY created_at ASC LIMIT 1`).
- **Works on empty + populated DBs.** Pre-flight checks should be `RAISE NOTICE`, never `EXCEPTION`, unless truly fatal. See `012_multi_tenant_rls.sql` for the pattern.

### How migrations actually deploy

```
You add 013_foo.sql to supabase/migrations/
   ↓ git push origin main
.github/workflows/migrate.yml fires (path filter on supabase/migrations/**)
   ↓ supabase link --project-ref akpbzaivscqvaoapkdwd
   ↓ supabase db push  (checks supabase_migrations.schema_migrations,
                        applies only versions not already recorded)
   ↓ NOTIFY pgrst, 'reload schema'  (so new columns are queryable right away)
   ↓
Vercel deploys the code (gated on this workflow passing, via the
"Wait for CI" project setting)
```

The `schema_migrations` table is the source of truth for what's applied where. If you ever need to know whether prod has a specific migration, query it directly.

### Manual override
You can always still apply by hand: `supabase db push --linked` from this dir, or paste SQL into the Dashboard editor. The CI is the default path; manual works for emergencies or one-offs.

## Don't touch lightly

- **`012_multi_tenant_rls.sql`** — the trigger functions and grants are load-bearing for sign-up. Layer changes via new migrations.
- **`src/middleware.ts`** — auth gate + onboarding gate + path whitelist live here. Order matters.
- **`src/lib/triage/orchestrator.ts`** — `applyOperation` runs the dedup gate, mutation, and audit log atomically. The order of checks (close → update → create) is intentional.

## GSAP gotchas

**GSAP cannot interpolate boxShadow values containing CSS custom properties.** A tween like:

```ts
// ❌ FAILS with "a is null" — gsap parser chokes on hsl(var(--*))
gsap.to(el, { boxShadow: "0 0 32px hsl(var(--primary) / 0.6)" });
```

Workaround: apply the shadow imperatively via the DOM style, animate only transform properties through GSAP:

```ts
// ✅ Works
el.style.transition = "box-shadow 0.2s ease-out";
el.style.boxShadow = "0 0 32px hsl(var(--primary) / 0.6)";
gsap.to(el, { y: -2, scale: 1.01, duration: 0.2 });
```

See `src/lib/animation/interactions.ts` for the canonical `useMagneticHover` pattern.

Other rules:
- Always wrap with `withMotion(() => ...)` from `src/lib/animation/index.ts` so users with `prefers-reduced-motion: reduce` get no animation.
- Use `useGSAP` from `@gsap/react` with a `scope` ref for auto-cleanup.

## React Compiler / lint quirks

The React Compiler ESLint plugin is strict. Patterns that look fine but error:

| Pattern | Fix |
|---|---|
| Hook returns a ref → caller assigns into it | Rename caller's variable to end in `Ref` (e.g. `hoverRef`, `burstRef`) — the rule whitelists `*Ref` names |
| `setState` directly inside `useEffect` body | Convert to `useQuery` + `setQueryData`, or move into an event handler. See `src/components/onboard/portcos-step.tsx` for the canonical fix |
| `Date.now()` inside `useMemo` / render | Pass the current time as state or as a dependency you already have. See `src/components/calendar/calendar-view.tsx` |
| Hooks after early return | Hoist all hooks to the top of the component, then early-return |

Run `pnpm verify` (= `tsc --noEmit && eslint`) before pushing. CI runs the same.

## AI tell sanitization

`src/lib/anthropic/stream.ts` strips em-dashes, en-dashes, and "double-hyphen" patterns from every delta of every streaming response. This is intentional — em-dashes are the single most reliable LLM tell and we don't want any user-facing copy to look AI-generated. Don't undo this. If you need a long-form dash, use `,` or rephrase.

## Auth + onboarding flow

1. User hits `/auth/sign-in` → Google OAuth via Supabase
2. `auth.users` INSERT fires two triggers:
   - `enforce_signup_allowlist_trigger` (BEFORE) — checks email domain is in `signup_allowlist`
   - `create_user_profile_trigger` (AFTER) — auto-creates `user_profile` row with `onboarding_step = 0`
3. `src/middleware.ts` checks `user_profile.onboarding_step`:
   - If `< 6` and `onboarded_at IS NULL` → redirect to `/onboard`
   - Exceptions (whitelisted during onboarding): `/onboard/*`, `/settings/connections`, `/settings/style`, `/companies`, `/api/*`
4. `/onboard/welcome` → 6 steps → `/onboard/tour` sets `onboarded_at` and lets them into `/cockpit`

To allow a new email domain: `INSERT INTO public.signup_allowlist (domain, note) VALUES ('newdomain.com', ...) ON CONFLICT DO NOTHING;`

## Local dev quirks

- **Dev server runs on port 3456**, not 3000. Set in `package.json` start script. Local Supabase `config.toml` `site_url` matches.
- **Local Supabase**: `supabase start` brings up the Docker stack. `supabase_db_mashi` is the postgres container.
- **`unset ANTHROPIC_API_KEY`** in `dev`/`build`/`start` scripts because the shell often has a stale empty key from elsewhere that overrides `.env.local`. Don't remove these `unset` calls.
- **`.env.local`** has the real secrets. Never commit. `.env*` is in `.gitignore`.
- **`pnpm verify`** = typecheck + lint. Run before pushing. No Husky/lint-staged because this directory lives inside `~/.git` (Sidd's home is one big git repo), so pre-commit hooks would fire on every home-dir commit.

## OAuth provider conventions

| Provider | Auth method | Notes |
|---|---|---|
| Google (Gmail, GCal, sign-in) | OAuth via Supabase Auth | App is in "Testing" — add each user as Test User in OAuth consent screen |
| Slack | Direct OAuth (via `/api/connect/slack/callback`) | Uses **User tokens** (`xoxp-`), not Bot tokens. Public Distribution active so other workspaces can install |
| Linear | Per-user **Personal API Key**, no OAuth | Linear OAuth tokens are limited. UI in `connections-manager.tsx` surfaces the workspace admin override path |
| Fireflies | API key only | Paste-and-go |
| Outlook / Microsoft Calendar | OAuth (Azure AD) | Wired but rarely used. Add prod redirect URI if a user needs it |

All OAuth tokens are encrypted at rest using `ENCRYPTION_KEY` (32-byte hex). See `src/lib/oauth/flow.ts`.

## Where docs live

- **`DEPLOY.md`** — ops/infra: provisioning, OAuth callbacks, inviting users, gotchas-by-provider, rollback. Update after any production change.
- **`AGENTS.md`** (this file) — code conventions, architectural invariants, "don't touch" warnings.
- **`CLAUDE.md`** — one-liner that imports this file so Claude Code picks it up.
- **`.env.example`** — full list of every env var. Keep in sync with code.
- **`supabase/migrations/`** — schema source of truth. Filename is the runbook order.
- **`scripts/setup-production.sh`** + **`scripts/post-domain-setup.sh`** — one-shot scripts. Read before running.

## Pull request hygiene

- CI must be green before merge (typecheck + lint + build).
- Migrations: include a smoke test or describe the verification in the PR body.
- New env vars: add to `.env.example` + Vercel project + this doc if it's a new external service.
- Touching `middleware.ts` or any trigger function: call it out in the PR description; these are easy to break.

## When in doubt

Search this codebase first — every gotcha here came from a real bug. If you can't find an example, ask, don't guess.
