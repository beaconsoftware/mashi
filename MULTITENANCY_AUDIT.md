# Multi-Tenancy & Single-Tenancy Hardcoding Audit

**Date:** 2026-05-30
**Branch:** `claude/multitenancy-hardcoding-audit-K6tes`
**Scope:** Full repository (`src/`, `supabase/migrations/`, `scripts/`, config).
**DB scope:** Migrations as source of truth (no live DB dump this pass).
**Deliverable:** Report only. No code changes or guardrail script landed in this pass.
**Config policy decision:** Single-tenant deployment config (Beacon domain, prod
project ref, GitHub repo owner) is treated as **in-scope to parameterize via
env**, not as accepted config.

---

## 1. What this audit covers

Two distinct failure classes, audited together:

- **Tenant-isolation defects** — a code path that can read or write another
  user's data: an RLS gap, an unscoped service-role query, a missing `user_id`
  on insert, or tenant data leaking through a shared surface (e.g. an LLM
  prompt).
- **Single-tenant hardcoding** — a literal (email, UUID, domain, name, project
  ref) or a "first user" assumption that makes the app behave correctly *only*
  for Sidd / Beacon.

## 2. Method

- Three parallel codebase sweeps: tenant identifiers, every
  `createSupabaseServiceClient` call site, and the DB/RLS schema from
  migrations.
- Findings flagged by the sweeps were then **independently verified by reading
  the cited lines** — several sweep flags were warning comments or intentional
  config, not live defects, and are downgraded/recharacterized below.

## 3. Severity rubric

| Sev | Meaning |
|-----|---------|
| **CRITICAL** | A user can read or write another user's data today. |
| **HIGH** | A feature is wrong for any non-Sidd user, or tenant data leaks into a shared surface. |
| **MEDIUM** | A documented/known compromise that weakens isolation, or hardcoding that blocks multi-deploy. |
| **LOW** | Cosmetic single-tenant leakage (example/placeholder copy), or ops-script hardcoding. |
| **EXCEPTION** | Intentional and correct (global tables, system jobs). Documented so it isn't re-flagged. |

---

## 4. Findings

### Summary table

| # | Sev | Layer | Finding | Location |
|---|-----|-------|---------|----------|
| F1 | HIGH | Runtime | "Assigned to me" filter hardcodes Sidd's email | `src/components/linear/linear-view.tsx:56` |
| F2 | MEDIUM | DB / RLS | `ai_usage_log` INSERT policy is `WITH CHECK (true)`; SELECT exposes `user_id IS NULL` rows to all users | `supabase/migrations/012_multi_tenant_rls.sql:256-264` |
| F3 | MEDIUM | Prompt | Beacon-specific example names baked into the system prompt sent to every tenant | `src/lib/triage/prompts.ts:34,42` |
| F4 | MEDIUM | Config | Hardcoded prod Supabase project ref + Beacon domain as script defaults | `scripts/post-domain-setup.sh:15-16` |
| F5 | LOW | Config | Private GitHub repo owner hardcoded (`sidd-beacon`) | `src/app/api/downloads/mac-helper/route.ts:21` |
| F6 | LOW | Prompt/UI | Beacon-specific example/placeholder copy ("MPP", "Snailworks", "Acme", "Vivek") | `mashi-memory-editor.tsx`, `planner-prioritize.tsx`, `seed-ci-test-user.ts` |
| F7 | LOW | Config | `signup_allowlist` seeded with `beaconsoftware.com` literal | `supabase/migrations/012_multi_tenant_rls.sql:305-307` |
| E1 | EXCEPTION | DB | `signup_allowlist` is a global (no `user_id`) table by design | `012`, `015_tighten_admin_tables.sql` |
| E2 | EXCEPTION | Code | Four cross-user system jobs (consolidate, propagate, ai-staleness, bundle-meetings) | `src/lib/triage/*` |
| E3 | EXCEPTION/HIST | DB | "primordial user" backfill (`ORDER BY created_at ASC LIMIT 1`, ~23 tables) | `012_multi_tenant_rls.sql` |

---

### F1 — Hardcoded current-user email in Linear "assigned to me" — **HIGH**

`src/components/linear/linear-view.tsx:56`
```ts
const meEmail = "sidd.sengupta@beaconsoftware.com"; // TODO: pull from user profile
r = r.filter((i) => (i.assignee_email ?? "").toLowerCase() === meEmail);
```
The "assigned to me" toggle filters against Sidd's literal email. For every
other user the filter silently matches nothing (or, worse, would match Sidd's
issues if they were ever visible). It is the clearest live single-tenant defect.

**Not a data-isolation breach** (RLS still scopes which issues load), but the
feature is non-functional for anyone but Sidd.

**Recommended fix:** derive the viewer's email from the session/profile (the
auth user's email, or the connected Linear account's email) and compare against
that. No literal.

---

### F2 — `ai_usage_log` RLS lets any user insert/see NULL-owner rows — **MEDIUM**

`supabase/migrations/012_multi_tenant_rls.sql:256-264`
```sql
-- Tracker writes via service-role (no JWT) so we leave INSERT open and only
-- tighten SELECT to own rows. user_id stays nullable for legacy service-role
-- writes; refactor trackedCreate to thread userId later.
DROP POLICY IF EXISTS "authed full access" ON ai_usage_log;
CREATE POLICY "own usage select" ON ai_usage_log
  FOR SELECT USING (auth.uid() = user_id OR user_id IS NULL);
CREATE POLICY "any insert" ON ai_usage_log
  FOR INSERT WITH CHECK (true);
```
This is a **documented, deliberate** compromise, not an oversight. Two
consequences:

1. `INSERT WITH CHECK (true)` — any authenticated client can write a usage row
   attributed to any (or no) `user_id`. Cost/usage data has no write integrity.
2. `SELECT ... OR user_id IS NULL` — every user can read every NULL-owner usage
   row. Any usage row that was written without a `user_id` is world-readable to
   all authenticated users.

The mitigating note says "refactor `trackedCreate` to thread userId later." The
service-role sweep observed `trackedCreate` (`src/lib/anthropic/tracked.ts:74`)
does now pass a `userId`, so new rows may be scoped — but the policy and the
`user_id IS NULL` legacy rows remain.

**Recommended fix (follow-up, not this pass):** confirm `trackedCreate` always
sets `user_id`; backfill or quarantine NULL-owner rows; then tighten to
`INSERT WITH CHECK (auth.uid() = user_id OR auth.uid() IS NULL)` (or restrict
inserts to service-role) and `SELECT USING (auth.uid() = user_id)`.

---

### F3 — Beacon-specific example names in the shared triage system prompt — **MEDIUM**

`src/lib/triage/prompts.ts:34,42`

The previously hardcoded `"Sidd"` **has been fixed** — the prompt now
interpolates a `${userName}` parameter (lines 16-20, 26), and the file's own
comment documents why (the old literal "caused every other user's LLM responses
to leak Sidd's name"). That part is clean.

What remains: the worked example embedded in the prompt is Beacon's real data:
```
... a Snailworks band-aid roll-up has Deborah doing X, Taylor doing Y ...
the canonical title names the initiative ("Snailworks roll-up band-aid rollout"),
and the description lists who's doing what ("Deborah: manual rollups.
Taylor: oversees process. ...")
```
"Snailworks", "Deborah", and "Taylor" are sent verbatim in **every tenant's**
triage call. Not a data-isolation breach (it's static prose, not another user's
DB rows), but it's one tenant's names leaking into every other tenant's model
context, and it biases the model toward Beacon's vocabulary.

**Recommended fix:** replace with a generic illustrative example ("a vendor
migration where Person A does X, Person B does Y") or a placeholder that doesn't
name real Beacon people/portcos.

---

### F4 — Prod project ref + Beacon domain hardcoded as script defaults — **MEDIUM**

`scripts/post-domain-setup.sh:15-16`
```sh
DOMAIN="${DOMAIN:-mashi.beaconsoftware.com}"
SUPABASE_REF="${SUPABASE_REF:-akpbzaivscqvaoapkdwd}"
```
The env-var fallbacks default to **production** values. Run with no env set, the
script targets prod (`https://api.supabase.com/v1/projects/$SUPABASE_REF/...`).
Per the config-policy decision (parameterize via env), these defaults should be
removed so the script fails loudly without an explicit target rather than
silently acting on prod.

**Recommended fix:** require `DOMAIN` and `SUPABASE_REF` (error if unset);
document them in the script header. Same treatment for the other prod literals
in this script (allowlist URLs at lines ~34, 47, 60-65).

---

### F5 — Private download repo owner hardcoded — **LOW**

`src/app/api/downloads/mac-helper/route.ts:21`
```ts
const OWNER = "sidd-beacon";
const REPO = "mashi";
```
This is the **GitHub repo owner** that hosts the Mac-helper release asset, not a
tenant identifier — but it's a deployment-specific literal sitting next to the
already-env-sourced `GITHUB_DOWNLOAD_TOKEN`. Per the config-policy decision, move
it to env for parity.

**Recommended fix:** `GITHUB_DOWNLOAD_OWNER` / `GITHUB_DOWNLOAD_REPO` env vars
(with the current values as documented defaults in `.env.example`), so a fork or
alternate deployment can point elsewhere.

---

### F6 — Beacon-specific example/placeholder copy in UI + seed — **LOW**

- `src/components/settings/mashi-memory-editor.tsx:81,142` — example memory text:
  `"I'm Sidd, at Beacon Software. Current portcos: MAP Policy Partners (MPP),
  Snailworks, Beacon SW."`
- `src/components/sprint/planner-prioritize.tsx:452,454,489` — "Snailworks",
  "MPP" in example code + placeholder `"e.g. Snailworks · quick wins · decisions"`.
- `scripts/seed-ci-test-user.ts:117,119` — fixture copy ("Acme procurement",
  "portco intro from Vivek").

Cosmetic — these are illustrative strings, not data paths. But they surface
one tenant's real names as the app's examples. Genericize when these components
are next touched.

---

### F7 — `signup_allowlist` seeded with the Beacon domain literal — **LOW**

`supabase/migrations/012_multi_tenant_rls.sql:305-307`
```sql
INSERT INTO signup_allowlist (domain, note)
VALUES ('beaconsoftware.com', 'Beacon Software product leads')
ON CONFLICT (domain) DO NOTHING;
```
The allowlist itself is the **correct** design (a runtime-editable table, not a
hardcoded check — see E1). Only the seed value is a literal. It's harmless
(idempotent, editable via SQL) but ties the migration history to Beacon.

**Recommended fix (optional):** seed from an env-provided list, or move the seed
out of the schema migration into an environment-specific bootstrap step.

---

## 5. Intentional exceptions (do not re-flag)

### E1 — `signup_allowlist` is a global table — **EXCEPTION**
No `user_id` column, by design — it gates *who may become* a tenant, so it
predates any user. RLS is enabled with no end-user policy; it is read only by the
`enforce_signup_allowlist()` `SECURITY DEFINER` trigger on `auth.users`. Verify
in any future change that the trigger path still reads it.

### E2 — Four cross-user system jobs — **EXCEPTION**
`consolidate`, `propagate`, `ai-staleness`, `bundle-meetings`
(`src/lib/triage/*`) use the service-role client and intentionally operate across
users, but each filters per-user with `.eq("user_id", userId)`. This matches the
AGENTS.md invariant. They are the *only* sanctioned cross-user readers.

### E3 — "primordial user" backfill — **EXCEPTION (historical)**
`012_multi_tenant_rls.sql` backfills ~23 tables with
`(SELECT id FROM auth.users ORDER BY created_at ASC LIMIT 1)`. This is a
one-time, idempotent migration that only fills pre-existing NULL `user_id`s from
the single-tenant era. It is **not** a runtime code path. Audit confirmed the
first-user pattern does **not** appear in `src/` runtime code — only in
`supabase/migrations/` and one-off ops scripts.

---

## 6. Service-role layer — status

The sweep enumerated ~160 `createSupabaseServiceClient` call sites across API
routes, sync modules, agent/triage libraries, and supporting libs, and reported
all of them scope by `user_id` (filter on read/update/delete, explicit set on
insert/upsert). Spot-checks (sync threading of `conn.user_id`, the four system
jobs, the agent thread loaders) corroborated this.

**Caveat:** this report did not independently re-read all ~160 sites line by
line (out of scope for a report-only pass). The full inventory is preserved
below as the checklist for a line-by-line verification follow-up — the
RLS-bypass surface is where a single missed `.eq("user_id", ...)` becomes a
CRITICAL, so it warrants the dedicated pass before any "multi-tenant ready"
sign-off.

---

## 7. One-off scripts (informational)

These hardcode Sidd's UUIDs / Beacon domain and are **acceptable as one-off ops
tooling**, but should never be wired into runtime or CI defaults:

- `scripts/migrate-sidd-to-prod.mjs:14-17,197` — local/prod UUIDs + prod URL.
- `scripts/check-sync.mjs:16` — Sidd's prod UUID.
- `scripts/seed-ci-test-user.ts:47` — `ci-visual@beaconsoftware.com` default.
- `scripts/test-onboard-*.mjs` — `*@beaconsoftware.com` synthetic emails.
- `supabase/migrations/014_per_user_ticket_numbers.sql:5` — comment references
  "Sidd"/"Matt" ticket ranges (comment only; the mechanism itself is per-user).

---

## 8. Recommended follow-ups (post-report)

1. **Fix F1** (hardcoded email) — small, high-value, isolated.
2. **Tighten F2** (`ai_usage_log` RLS) — confirm `trackedCreate` threading,
   backfill NULL-owner rows, then a new migration to tighten the policies.
3. **Genericize F3/F6** prompt + UI example copy.
4. **Env-parameterize F4/F5** deployment literals; update `.env.example`.
5. **Line-by-line service-role verification** using the §6 inventory.
6. **Standing guardrail** — a `scripts/audit-tenancy.sh` wired into `pnpm verify`
   + CI (mirroring `audit:layers`/`audit:motion`) that fails on new email/domain/
   project-ref literals in `src/`, on a service-role file with no nearby
   `user_id` filter (with a `// tenancy-audit-ok:` carve-out), and on the
   first-user pattern outside `supabase/migrations/`. Plus a `pg_policies`
   assertion query that fails on any non-owner-scoped policy. *(Not built this
   pass — deliverable was report-only.)*
