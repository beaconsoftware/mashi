# Mashi Multi-Tenancy Remediation (spec input)

Implementation plan for the findings in [`MULTITENANCY_AUDIT.md`](MULTITENANCY_AUDIT.md).
That document is the evidence; this one is the execution plan. Item IDs here
reuse the audit's `T*` (isolation/security) and `H*` (hardcoding) IDs so every
brief traces back to a verified finding with file:line evidence.

Same shape and protocol as [`AGENT_IMPROVEMENT_FINDINGS.md`](AGENT_IMPROVEMENT_FINDINGS.md):
epics with per-item briefs, collapsed into a small number of thematic PR batches,
driven by a repeatable loop. Read that doc's conventions first if this is your
first run; the legend and "how to read a brief" are reproduced below.

## North star

Every code path is tenant-isolated and nothing single-tenant is hardcoded, and
it stays that way because the invariants are **enforced in CI**, not just
documented. The audit proved the DB layer (RLS on all 31 tenant tables) and the
agent/MCP/crypto/storage layers are clean; the work here is the confirmed
service-role read defects, the route auth-gate gaps, a DB-policy tightening, the
de-hardcoding, and the standing guardrail that makes regression loud.

## Execution protocol (the loop)

### The repeatable continuation prompt (paste verbatim each run)

> Open `MULTITENANCY_REMEDIATION.md`. Pick the lowest-Order batch in the ledger
> whose `deps` are all `MERGED` and whose status is `TODO`. Implement every brief
> in its `covers` set on a branch off `main`, following each brief's
> implementation approach and acceptance criteria. Run `pnpm verify` plus
> `supabase/tests/rls_assertions.sql` against a local DB. Open one PR for the
> batch, set the row to `IN REVIEW (#N)`, and update the ledger. Do not merge.
> If a brief is ambiguous, STOP and ask rather than guess.

### What the run does each time (precise)

1. Re-read this ledger on `main` (durable record).
2. Select the next eligible batch (deps `MERGED`, status `TODO`, lowest Order).
3. Implement the briefs; keep the diff to the batch's `covers` set.
4. Verify: `pnpm verify` (typecheck + lint + audits + unit tests) AND run the
   RLS assertion script; for isolation fixes, add/extend a test that proves the
   cross-tenant path now returns nothing for a second user.
5. One batch, one PR. Update the ledger row to `IN REVIEW (#N)`.

### Rules

- One batch, one PR, per run.
- **Never merge; never push to `main`.** Sidd reviews and merges.
- Dependencies are satisfied only by `MERGED`, not `IN REVIEW`.
- If a brief is ambiguous or you would have to guess at product intent, STOP and ask.
- Every run updates this ledger; the ledger on `main` is the durable record.

### Status legend

`TODO` (not started) · `IN REVIEW (#N)` (PR open) · `MERGED (#N)` (landed) ·
`BLOCKED` (note why). A ticked box `[x]` means `MERGED`.

## Progress ledger

Collapsed into batches (lowest Order first). Each batch is one PR landing every
brief in its `covers` set; `deps` are predecessor batches that must be `MERGED`
first. The per-item briefs (Epics A-F) are the implementation detail.

Most batches are independent and could be parallelized via stacked branches, but
the default is serial-on-merged. **P6 (the guardrail) must land last** — wiring
the `audit:tenancy` check before the violations are fixed would make CI red
immediately. (Alternative: land P6 first with every outstanding file carved out,
then remove carve-outs as P1-P5 land. Default plan keeps it last.)

### Landed

- _(none yet — the audit + `rls_assertions.sql` + tightened AGENTS.md landed in #156)_

### Batches

- [ ] **1 · P1 · Cross-tenant service-role scoping** · covers T1, T2, T3, T4, T5, T6, T7 · deps: none · TODO · PR: -
  > The real breaches, all in service-role paths where RLS is bypassed. Add
  > `.eq("user_id", …)` to the Fireflies close-detection reads (T1/T2) and the
  > `action_items_extracted` write (T3); scope the Fireflies/Gmail gate reads
  > (T4/T5) and the reconcile `linear_issues` lookup (T6); give
  > `getActiveAccessToken` a `userId` param so it self-scopes (T7). Mostly
  > one-line diffs; `conn.user_id`/`userId` is already in scope at each site.
  > Highest priority, lowest risk. Internal order: T7 first (touches a shared
  > helper signature), then T1-T6.
- [ ] **2 · P2 · Route auth-gate hardening** · covers T8, T9, T12, T13, T14 · deps: none · TODO · PR: -
  > Enforce auth before any DB/LLM call: `s2d/[id]/suggest` (T8) and
  > `style/extract` (T9) must 401 and pass `user.id` to the model call; add
  > explicit `getUser()` + ownership checks (not silent RLS reliance) to
  > `s2d/[id]/context` (T12), `connections/[id]` DELETE/PATCH (T13), and
  > `sync/[provider]/[connectionId]` (T14), returning 401/404 correctly.
- [ ] **3 · P3 · RLS + cost-attribution integrity** · covers T10, T17 · deps: none · TODO · PR: -
  > Thread `userId` into every `trackedCreate` (the 4 system jobs + suggest +
  > style/extract) so no more `user_id NULL` usage rows (T17); then a migration
  > tightening `ai_usage_log` INSERT to `WITH CHECK (auth.uid() = user_id OR
  > auth.uid() IS NULL)` (T10). SELECT is already owner-only (015). One migration.
- [ ] **4 · P4 · Defense-in-depth** · covers T11, T15, T16, T18 · deps: none · TODO · PR: -
  > Sanitizer parity on the 5 agent search-tool `.or()` filters (T11, strip
  > `,()`); add `.eq("user_id", …)` to all `connected_accounts` status stamps
  > (T15); verify item ownership in `getOrCreateThreadForItem` (T16);
  > constant-time `CRON_SECRET` compare + a rate-limit shim on LLM/auth routes
  > (T18). No cross-tenant break in any of these today; hardening only.
- [ ] **5 · P5 · De-hardcode → env** · covers H1, H3, H4, H5, H6, H7 · deps: none · TODO · PR: -
  > Fix the Linear "assigned to me" hardcoded email (H1, the one user-facing
  > bug here); genericize Beacon example copy in the triage prompt + UI (H3/H6);
  > move prod project ref / domain / download repo-owner / allowlist seed to env
  > and update `.env.example` (H4/H5/H7).
- [ ] **6 · P6 · Standing guardrail** · covers F1, F2 · deps: P1, P2, P3, P4, P5 · TODO · PR: -
  > `scripts/audit-tenancy.sh` + `audit:tenancy` in `pnpm verify` and CI (F1):
  > flags service-role files with a query lacking a nearby `user_id` filter
  > (`// tenancy-audit-ok:` carve-out), email/domain/project-ref literals in
  > `src/`, and the first-user pattern outside migrations. Wire
  > `supabase/tests/rls_assertions.sql` into CI against the migrated DB (F2).
  > Lands last so it goes green on a clean tree.

## How to read a brief

Each brief uses this structure (same as `AGENT_IMPROVEMENT_FINDINGS.md`):

- **ID / Title**
- **Layer**: Backend / DB-Migration / Frontend / Config / Tooling
- **Severity** (audit): from the audit's severity table
- **Effort**: S / M / L / XL (S = under ~1 day, M = ~1-3 days, L = ~1-2 weeks)
- **Problem** · **Evidence** (file:line, see audit) · **Target state** ·
  **Implementation approach** · **Acceptance criteria** (testable) ·
  **Dependencies** · **Out of scope**

## Severity vs effort conventions

Severity is reserved for correctness / data-integrity / trust defects. Effort:
S = under ~1 day, M = ~1-3 days, L = ~1-2 weeks. Most of P1-P5 is S; P6 is M.

## Epic index

- **EPIC A — Cross-tenant service-role scoping** (T1-T7): the confirmed breaches.
- **EPIC B — Route auth-gate hardening** (T8, T9, T12-T14).
- **EPIC C — DB / RLS integrity** (T10, T17): one migration + threading.
- **EPIC D — Defense-in-depth** (T11, T15, T16, T18).
- **EPIC E — De-hardcode → env** (H1, H3-H7).
- **EPIC F — Enforcement guardrail** (audit:tenancy + rls_assertions in CI).

---

# EPIC A: Cross-tenant service-role scoping

The audit's headline. These run under `createSupabaseServiceClient` (RLS
bypassed), and query by a *shared* key (`source_thread_id`, `company_id`,
`external_id`) without a `user_id` filter, so they return other tenants' rows.
This is now AGENTS.md Hard Rule #4.

## A1. Scope `loadCloseDetectionContext` to the owner (T1 + T2)

- **Layer**: Backend · **Severity**: HIGH · **Effort**: S
- **Problem**: The Fireflies "existing items" context for triage reads
  `s2d_items` by `source_thread_id` and by shared `company_id` with no
  `user_id` filter, then feeds the result into the triage LLM as `existing_items`.
  Another tenant's open items (and their titles) leak into this user's model
  context and can drive wrong auto-close/update operations.
- **Evidence**: `src/lib/sync/fireflies-sync.ts:253-258` (own-items read),
  `:262-268` (company read), consumed at `:174` → `runTriageOnUnit`.
- **Target state**: Both reads scoped to the meeting's owner.
- **Implementation approach**: Add a `userId: string` param to
  `loadCloseDetectionContext`; pass `conn.user_id` from the call site (`:174`,
  it's already in scope as `conn`). Add `.eq("user_id", userId)` to both
  `s2d_items` queries.
- **Acceptance criteria**: A test where user B has an open `s2d_item` under the
  same `company_id` / `source_thread_id` as user A's meeting confirms B's item
  is NOT returned for A. `pnpm verify` green.
- **Dependencies**: none. **Out of scope**: the cross-portfolio "shared company"
  product question (today `company_id` is per-user; if shared companies are ever
  introduced, revisit deliberately).

## A2. Scope the `action_items_extracted` write (T3)

- **Layer**: Backend · **Severity**: HIGH · **Effort**: S
- **Problem**: `meetings.action_items_extracted` is set by `external_id` only —
  a cross-tenant **write**. A shared Fireflies transcript means user A's sync
  flips user B's flag, suppressing B's action-item extraction.
- **Evidence**: `src/lib/sync/fireflies-sync.ts:199-202`.
- **Target state**: Update scoped to `conn.user_id`.
- **Implementation approach**: Add `.eq("user_id", conn.user_id)` to the
  `.update({ action_items_extracted: true }).eq("external_id", t.id)` chain.
- **Acceptance criteria**: Test proves the update affects only the owner's row.
- **Dependencies**: none.

## A3. Scope the Fireflies + Gmail gate reads (T4 + T5)

- **Layer**: Backend · **Severity**: MEDIUM · **Effort**: S
- **Problem**: The Fireflies triage-gate `meetings` read (`external_id` only) and
  the Gmail `loadKnownExternalIds` dedup read (`messages` by `external_id` only)
  query across all tenants.
- **Evidence**: `fireflies-sync.ts:142-145`, `gmail-sync.ts:569-572`.
- **Target state**: Both scoped by `user_id`; matches the upsert conflict key
  `(user_id, external_id)`.
- **Implementation approach**: Thread `conn.user_id` into both and add
  `.eq("user_id", …)`.
- **Acceptance criteria**: dedup/gate logic still works for the owner; a second
  user's same-`external_id` rows don't appear. `pnpm verify` green.

## A4. Scope the reconcile `linear_issues` lookup (T6)

- **Layer**: Backend · **Severity**: MEDIUM · **Effort**: S
- **Problem**: Reconcile reads `linear_issues` by `external_id` with no
  `user_id`, then maps to a `connected_account_id` that could belong to a
  different tenant who tracks the same issue → reconciler uses the wrong user's
  Linear OAuth token.
- **Evidence**: `src/lib/triage/reconcile.ts:104-107` (`userId` in scope at `:91`).
- **Implementation approach**: Add `.eq("user_id", userId)` to the
  `linear_issues` select.
- **Acceptance criteria**: `connByExternal` only ever maps to the owner's
  connection. Test with two users tracking the same Linear external_id.

## A5. Make `getActiveAccessToken` self-scope (T7)

- **Layer**: Backend · **Severity**: MEDIUM (latent IDOR) · **Effort**: S-M
- **Problem**: `getActiveAccessToken(connectionId)` decrypts OAuth tokens by id
  on a service-role client with no ownership check. Safe today only because
  every caller pre-verifies; one careless future caller = account-takeover IDOR.
- **Evidence**: `src/lib/oauth/flow.ts:153-193`; callers in sync routes + Slack
  channels route.
- **Target state**: The function self-enforces; callers can't forget.
- **Implementation approach**: Add a required `userId: string` param; add
  `.eq("user_id", userId)` to the lookup and the refresh update. Update all
  callers to pass the authenticated/owner `userId` (sync paths already have
  `conn.user_id`; route callers have the session user). Do this **first** in the
  batch since it changes a shared signature.
- **Acceptance criteria**: typecheck forces every caller to pass `userId`; a test
  with a foreign `connectionId` returns no token. `pnpm verify` green.
- **Dependencies**: none (ordered first within P1).

---

# EPIC B: Route auth-gate hardening

Routes must derive identity from session/token and 401 before any DB/LLM call
(AGENTS.md Hard Rule #6). None of these is a confirmed leak today (middleware /
RLS mitigate), but they lack defense-in-depth.

## B1. Enforce auth in `s2d/[id]/suggest` (T8)

- **Layer**: Backend · **Severity**: MEDIUM · **Effort**: S
- **Problem**: `getUser()` result is never checked; the handler proceeds to
  `streamClaudeText` with `userId: user?.id ?? null` — unauthenticated LLM spend,
  no attribution.
- **Evidence**: `src/app/api/s2d/[id]/suggest/route.ts:38-56`.
- **Implementation approach**: `if (!user) return 401` immediately after
  `getUser()`; pass `user.id` (non-null) to `streamClaudeText`.
- **Acceptance criteria**: anonymous request → 401, no model call; usage row has
  a `user_id`.

## B2. Gate `style/extract` before the LLM call (T9)

- **Layer**: Backend · **Severity**: MEDIUM · **Effort**: S
- **Problem**: `trackedCreate` runs *before* the `getUser()` that only gates
  persistence.
- **Evidence**: `src/app/api/style/extract/route.ts:67` (LLM) vs `:112` (auth).
- **Implementation approach**: Move `getUser()` + 401 to the top of the handler;
  pass `user.id` to `trackedCreate`.
- **Acceptance criteria**: anonymous → 401 with no model call; usage attributed.

## B3. Explicit auth + ownership on the RLS-only routes (T12, T13, T14)

- **Layer**: Backend · **Severity**: LOW · **Effort**: S-M
- **Problem**: `s2d/[id]/context`, `connections/[id]` (DELETE/PATCH), and
  `sync/[provider]/[connectionId]` never call `getUser()`; they rely solely on
  RLS and return 404/204 instead of 401. One copy-paste to a service-role client
  silently removes isolation.
- **Evidence**: `s2d/[id]/context/route.ts:25-31`, `connections/[id]/route.ts`,
  `sync/[provider]/[connectionId]/route.ts:26-33`.
- **Implementation approach**: Add `getUser()` + 401; for `[id]` routes assert
  the row belongs to the user (explicit `.eq("user_id", user.id)` on the read, or
  check `rowsAffected`/`maybeSingle` and 404 on miss). `connections/[id]` DELETE
  should 404 on 0 rows rather than silent 204.
- **Acceptance criteria**: anonymous → 401; cross-user id → 404; owner → works.

---

# EPIC C: DB / RLS integrity

## C1. Tighten `ai_usage_log` INSERT (T10)

- **Layer**: DB-Migration · **Severity**: LOW · **Effort**: S
- **Problem**: INSERT policy is `WITH CHECK (true)` — any authed user can write
  usage rows under another user's `user_id` (telemetry pollution). SELECT is
  already owner-only (015), so there is no read leak.
- **Evidence**: `012_multi_tenant_rls.sql:263-264`; corrected by `015:36-38`.
- **Implementation approach**: New migration: `DROP POLICY "any insert"`, create
  `INSERT WITH CHECK (auth.uid() = user_id OR auth.uid() IS NULL)` — keeps
  service-role writes (auth.uid() NULL), blocks authed spoofing. Additive,
  idempotent (`DROP POLICY IF EXISTS`), per migration discipline.
- **Dependencies**: ordered after C2 (so no new NULL rows are being created when
  we reason about the policy), though not strictly required.
- **Acceptance criteria**: authed client cannot insert a row with a foreign
  `user_id`; service-role insert still succeeds; `rls_assertions.sql` no longer
  flags `ai_usage_log` INSERT.

## C2. Thread `userId` into every `trackedCreate` (T17)

- **Layer**: Backend · **Severity**: LOW · **Effort**: S
- **Problem**: The 4 system jobs + `suggest` + `style/extract` call
  `trackedCreate` without `userId` → `ai_usage_log` rows with `user_id NULL`,
  invisible to all clients (lost cost attribution).
- **Evidence**: `consolidate.ts:234`, `propagate.ts:178`, `ai-staleness.ts:157`,
  `bundle-meeting-items.ts:180`, plus B1/B2 routes.
- **Implementation approach**: Pass the in-scope `userId` to each `trackedCreate`
  (thread it through `askToBundle` / `askHaikuForStale` which currently take
  `userName` but not `userId`).
- **Acceptance criteria**: no new `user_id NULL` rows in `ai_usage_log`;
  `/settings/usage` cost totals include system-job spend for the owner.

---

# EPIC D: Defense-in-depth

## D1. Sanitizer parity on agent search `.or()` filters (T11)

- **Layer**: Backend · **Severity**: MEDIUM · **Effort**: S
- **Problem**: 5 agent search tools interpolate input into PostgREST `.or()`
  stripping only `%_`, not `,()`. Not cross-tenant today (AND-scoped by
  `user_id`), but inconsistent with `keywords.ts:62`.
- **Evidence**: `who_is.ts`, `search_everything.ts`, `search_messages.ts`,
  `search_board.ts`, `search_meetings.ts`, `search_linear.ts`.
- **Implementation approach**: Change the sanitizer to `replace(/[%_,().]/g, "")`
  (match `keywords.ts`); ideally extract a shared `sanitizeOrTerm` helper.
- **Acceptance criteria**: a `,`/`(` in the query can't alter the filter; tests.

## D2. Scope `connected_accounts` status stamps (T15)

- **Layer**: Backend · **Severity**: LOW · **Effort**: S
- **Problem**: All sync status updates (`markSyncSuccess`, etc.) and
  `reauth.ts` updates use `.eq("id", connectionId)` with no `user_id`.
- **Implementation approach**: Add `.eq("user_id", conn.user_id)` everywhere a
  `connectionId`-only `connected_accounts` update appears across the sync files
  and `oauth/reauth.ts:72,109`.
- **Acceptance criteria**: each status update is double-keyed; `pnpm verify`.

## D3. Verify item ownership in `getOrCreateThreadForItem` (T16)

- **Layer**: Backend · **Severity**: LOW · **Effort**: S
- **Problem**: A thread row can be created against a foreign `itemId`
  (thread-squatting; no data read). 
- **Evidence**: `src/lib/agent/threads.ts:92` + 6 route call sites.
- **Implementation approach**: Before creating, confirm the item is owned
  (`s2d_items` select `.eq("user_id", userId).eq("id", itemId)`); 404 if not.
- **Acceptance criteria**: creating a thread for a foreign item → 404.

## D4. Constant-time `CRON_SECRET` + rate limiting (T18)

- **Layer**: Backend · **Severity**: LOW · **Effort**: S-M
- **Problem**: `CRON_SECRET` compared with `!==`; no rate limiting on
  LLM-invoking / auth routes.
- **Evidence**: `sync/all/route.ts:70`, `activity/maintenance/route.ts:39`.
- **Implementation approach**: `crypto.timingSafeEqual` for the secret; add a
  minimal per-IP/per-user rate-limit shim to the LLM and auth routes (scope to be
  confirmed — may split out if it grows).
- **Acceptance criteria**: secret check constant-time; basic rate-limit in place.
- **Out of scope**: a full WAF / distributed rate-limiter (infra concern noted in
  the audit's residual gaps).

---

# EPIC E: De-hardcode → env

## E1. Derive the Linear "assigned to me" identity (H1)

- **Layer**: Frontend · **Severity**: HIGH (feature broken for non-Sidd) · **Effort**: S
- **Problem**: `meEmail = "sidd.sengupta@beaconsoftware.com"` drives the filter.
- **Evidence**: `src/components/linear/linear-view.tsx:56`.
- **Implementation approach**: Resolve the viewer's email from the session /
  profile (or the connected Linear account's email) and compare to that.
- **Acceptance criteria**: the filter works for any signed-in user; no literal.

## E2. Genericize Beacon example copy (H3, H6)

- **Layer**: Backend (prompt) + Frontend · **Severity**: MEDIUM/LOW · **Effort**: S
- **Problem**: Beacon names ("Snailworks", "Deborah", "Taylor") in the shared
  triage system prompt; Beacon example/placeholder copy in UI + seed.
- **Evidence**: `triage/prompts.ts:34,42`; `mashi-memory-editor.tsx`,
  `planner-prioritize.tsx`, `seed-ci-test-user.ts`.
- **Implementation approach**: Replace with generic illustrative examples
  ("Person A / Person B", "a vendor migration").
- **Acceptance criteria**: no real Beacon people/portco names in shipped strings.

## E3. Env-parameterize deployment literals (H4, H5, H7)

- **Layer**: Config · **Severity**: LOW · **Effort**: S
- **Problem**: prod Supabase ref + Beacon domain as script defaults; download
  repo-owner literal; allowlist seeded with `beaconsoftware.com`.
- **Evidence**: `scripts/post-domain-setup.sh:15-16`,
  `api/downloads/mac-helper/route.ts:21`, `012_multi_tenant_rls.sql:305-307`.
- **Implementation approach**: Require `DOMAIN`/`SUPABASE_REF` (no prod default,
  error if unset); `GITHUB_DOWNLOAD_OWNER`/`_REPO` env (documented defaults);
  seed allowlist from env or move out of schema migration. Update `.env.example`.
- **Acceptance criteria**: no prod-specific literal is the silent default; app is
  deployment-agnostic; `.env.example` lists the new vars.

---

# EPIC F: Enforcement guardrail

## F1. `audit:tenancy` script wired into `pnpm verify` + CI

- **Layer**: Tooling · **Effort**: M
- **Problem**: The invariants (AGENTS.md Hard Rules 1-7) are advisory; nothing
  fails the build on a new unscoped service-role read or a new hardcoded literal.
- **Target state**: A coarse grep gate, in the spirit of `audit:layers` /
  `audit:motion`, that catches the regression classes this audit found.
- **Implementation approach**: `scripts/audit-tenancy.sh` flagging: (a) a file
  using `createSupabaseServiceClient` with a `.from(...).select/update/delete`
  whose nearby lines have no `user_id` (allow `// tenancy-audit-ok: <reason>`);
  (b) email/domain/known-project-ref literals in `src/`; (c) the first-user
  `ORDER BY created_at ... LIMIT 1` pattern outside `supabase/migrations/`. Add
  `"audit:tenancy"` to `package.json` and into the `verify` chain + CI.
- **Acceptance criteria**: passes on a clean tree (post P1-P5); fails on a seeded
  unscoped read and on a planted literal. Carve-outs documented.
- **Dependencies**: P1-P5 merged (else it fails on known violations).

## F2. Run `rls_assertions.sql` in CI

- **Layer**: Tooling · **Effort**: S
- **Problem**: The migrations-vs-live drift gap is only closeable by hand today.
- **Implementation approach**: Add a CI step (extend the migrate workflow or a
  dedicated job) that runs `supabase/tests/rls_assertions.sql` against the
  migrated DB; section 6 raises on any non-owner-only tenant table, failing the
  build.
- **Acceptance criteria**: a deliberately loosened policy on a branch turns CI
  red.
- **Dependencies**: C1 merged (so `ai_usage_log` INSERT is no longer flagged), or
  add `ai_usage_log` INSERT to a documented allowance until C1 lands.
