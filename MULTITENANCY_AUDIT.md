# Multi-Tenancy & Security Isolation Audit — Exhaustive

**Date:** 2026-05-30
**Branch:** `claude/multitenancy-hardcoding-audit-K6tes`
**Type:** Full line-by-line verification (not a sampled sweep).

## Coverage

This audit independently read and verified, query-by-query:

- **All 90 API route handlers** under `src/app/api/**` — for (a) how `userId` is
  derived (must be session/token, never client input) and (b) whether every DB
  access is scoped to it.
- **All 98 `createSupabaseServiceClient()` call sites across 64 files** — the
  RLS-bypass surface, where a single missing `.eq("user_id", …)` is a
  cross-tenant breach.
- **Cross-cutting mechanisms** — `middleware.ts` auth gate, the MCP API-token
  scheme, OAuth token encryption, Supabase Storage RLS, embeddings/vector
  search, secret handling, and PostgREST filter construction.
- **DB layer** from `supabase/migrations/` (RLS policies, trigger functions).

Every finding below was confirmed by reading the cited lines. The sub-scans'
"PASS" claims were treated as inventory and re-verified, not trusted.

## What this audit did NOT cover (residual gaps to a true fintech bar)

These remain open regardless of fixing everything below — they are out of scope
for a static, migrations-only pass:

1. **Live-DB drift.** We audited migrations, not a `pg_policies` dump from prod.
   A policy dropped/altered by hand in the dashboard would not show here.
2. **Dependency / supply-chain** (no `pnpm audit`, no SBOM review).
3. **Secret rotation, infra IAM, network policy, WAF/rate-limiting** (no
   per-route rate limits were found — relevant to credential-stuffing / LLM
   cost-abuse).
4. **Penetration testing / fuzzing** of live endpoints.
5. **Logging/audit-trail completeness & retention** for compliance (SOC2/PCI).

A clean static audit + these five closed is the honest definition of
"fintech-grade." This document gets you the first half rigorously.

---

## Severity-ranked findings

| ID | Sev | Class | Finding | Location |
|----|-----|-------|---------|----------|
| T1 | **HIGH** | Cross-tenant READ→LLM | Triage "existing items" context pulls `s2d_items` by `source_thread_id` with no `user_id` | `src/lib/sync/fireflies-sync.ts:253-258` |
| T2 | **HIGH** | Cross-tenant READ→LLM | Same context pulls `s2d_items` by shared `company_id` with no `user_id` | `src/lib/sync/fireflies-sync.ts:262-268` |
| T3 | **HIGH** | Cross-tenant WRITE | `meetings.action_items_extracted` updated by `external_id` only — can mark another tenant's meeting, suppressing their triage | `src/lib/sync/fireflies-sync.ts:199-202` |
| H1 | **HIGH** | Hardcoding | "Assigned to me" filter hardcodes Sidd's email | `src/components/linear/linear-view.tsx:56` |
| T4 | **MEDIUM** | Cross-tenant READ | Fireflies triage gate reads `meetings` by `external_id`, no `user_id` | `src/lib/sync/fireflies-sync.ts:142-145` |
| T5 | **MEDIUM** | Cross-tenant READ | Gmail dedup gate reads `messages` by `external_id`, no `user_id` | `src/lib/sync/gmail-sync.ts:569-572` |
| T6 | **MEDIUM** | Cross-tenant / wrong-token | Reconcile reads `linear_issues` by `external_id`, no `user_id` → may select another user's `connected_account_id` and use their OAuth token | `src/lib/triage/reconcile.ts:104-107` |
| T7 | **MEDIUM** | Latent IDOR | `getActiveAccessToken(connectionId)` decrypts OAuth tokens by id with no ownership check — safe only because every current caller pre-verifies | `src/lib/oauth/flow.ts:153-193` |
| T8 | **MEDIUM** | Unauth LLM / no attribution | `s2d/[id]/suggest` calls `getUser()` but never checks it; proceeds to LLM call with `userId: null` | `src/app/api/s2d/[id]/suggest/route.ts:38-56` |
| T9 | **MEDIUM** | Unauth LLM / no attribution | `style/extract` runs the LLM call *before* any auth check; `getUser()` only gates persistence | `src/app/api/style/extract/route.ts:67-112` |
| T10 | **LOW** | RLS / integrity | `ai_usage_log` INSERT `WITH CHECK (true)` lets any authed user write usage rows under another user's `user_id` (telemetry pollution) or NULL. **SELECT is owner-only** — corrected: migration **015** dropped the `OR user_id IS NULL` clause, so there is **no cross-tenant read leak** | `012:256-264` (INSERT), `015:36-38` (SELECT, tightened) |
| T11 | **MEDIUM** | Injection (defense-in-depth) | 5 agent search tools interpolate input into PostgREST `.or()` stripping only `%_`, not `,()`. AND-scoped by `user_id` so not cross-tenant today; inconsistent with `keywords.ts:62` | `who_is.ts`, `search_everything.ts`, `search_messages.ts`, `search_board.ts`, `search_meetings.ts`, `search_linear.ts` |
| H3 | **MEDIUM** | Hardcoding | Beacon example names in shared triage system prompt | `src/lib/triage/prompts.ts:34,42` |
| T12 | **LOW** | No app-layer auth (RLS-only) | `s2d/[id]/context` has no `getUser()`; reads item by `id`, returns 404 not 401 | `src/app/api/s2d/[id]/context/route.ts:25-31` |
| T13 | **LOW** | No app-layer auth (RLS-only) | `connections/[id]` DELETE/PATCH have no `getUser()`; silent 204 on cross-user mutation | `src/app/api/connections/[id]/route.ts` |
| T14 | **LOW** | No explicit 401 (RLS-only) | `sync/[provider]/[connectionId]` relies solely on RLS, no `getUser()`/401 | `src/app/api/sync/[provider]/[connectionId]/route.ts:26-33` |
| T15 | **LOW** | Defense-in-depth | `connected_accounts` status stamps updated by `id` only (no `user_id`) across all sync files + reauth | `gmail/slack/gcal/fireflies/linear-sync.ts`, `oauth/reauth.ts:72,109` |
| T16 | **LOW** | Integrity | `getOrCreateThreadForItem` doesn't verify `itemId` ownership before creating a thread row (thread-squatting, no data read) | `src/lib/agent/threads.ts:92` + 6 route call sites |
| T17 | **LOW** | Cost attribution | `trackedCreate` called without `userId` in the 4 system jobs + 2 routes → `ai_usage_log` rows written with `user_id NULL`. Post-015 these are invisible to all clients (orphaned), so it is a lost-cost-attribution issue, not a leak | `consolidate.ts:234`, `propagate.ts:178`, `ai-staleness.ts:157`, `bundle-meeting-items.ts:180`, `style/extract`, `s2d/[id]/suggest` |
| T18 | **LOW** | Crypto hygiene | `CRON_SECRET` compared with `!==` (non-constant-time) | `sync/all/route.ts:70`, `activity/maintenance/route.ts:39` |
| H4 | **LOW** | Config (parameterize) | Prod Supabase ref + Beacon domain as script defaults | `scripts/post-domain-setup.sh:15-16` |
| H5 | **LOW** | Config (parameterize) | Private download repo owner hardcoded | `src/app/api/downloads/mac-helper/route.ts:21` |
| H6 | **LOW** | Hardcoding | Beacon example/placeholder copy | `mashi-memory-editor.tsx`, `planner-prioritize.tsx`, `seed-ci-test-user.ts` |
| H7 | **LOW** | Config | `signup_allowlist` seeded with Beacon domain literal | `012_multi_tenant_rls.sql:305-307` |

---

## Detail — the cross-tenant defects (T1–T6)

These are the headline of the audit: the service-role sync/triage paths bypass
RLS, and a cluster of queries there omit the `user_id` filter. **The Fireflies
sync is the worst offender** — and crucially, `conn.user_id` is already in scope
at every one of these call sites, so the fixes are one `.eq` each.

### T1 / T2 — `loadCloseDetectionContext` reads other tenants' items (HIGH)
`src/lib/sync/fireflies-sync.ts:248-270`
```ts
async function loadCloseDetectionContext(supabase, meetingExternalId, companyId) {
  const { data: own } = await supabase
    .from("s2d_items")
    .select("id, title, status, pathway, priority, created_at")
    .eq("source_type", "fireflies")
    .eq("source_thread_id", meetingExternalId)   // ← no .eq("user_id", …)
    .neq("status", "done");
  ...
    const { data } = await supabase
      .from("s2d_items")
      .select(...)
      .eq("company_id", companyId)               // ← no .eq("user_id", …)
      .neq("status", "done").limit(30);
```
The returned items become `existing_items` fed into `runTriageOnUnit` (line 174).
Any other tenant whose item shares that Fireflies transcript id, or whose item
is under the same `company_id`, leaks into this user's triage LLM context — and
can drive incorrect auto-close/update operations on the board. The caller has
`conn.user_id` (line 181); thread it in and add `.eq("user_id", userId)` to both
queries.

### T3 — cross-tenant write of `action_items_extracted` (HIGH)
`src/lib/sync/fireflies-sync.ts:199-202`
```ts
await supabase.from("meetings")
  .update({ action_items_extracted: true })
  .eq("external_id", t.id);     // ← no .eq("user_id", …) — service-role, RLS bypassed
```
Marks **every** tenant's meeting row with that Fireflies `external_id`. A shared
transcript means user A's sync flips user B's flag, suppressing B's
action-item extraction. Add `.eq("user_id", conn.user_id)`.

### T4 / T5 — unscoped dedup/gate reads (MEDIUM)
`fireflies-sync.ts:142-145` (`meetings` by `external_id`) and
`gmail-sync.ts:569-572` (`messages` by `external_id`) both query across all
tenants. Gmail message ids are per-mailbox so real collision is unlikely, but
the upsert conflict key is already `user_id,external_id` — the gate read should
match. Add `.eq("user_id", …)`.

### T6 — reconcile may use the wrong tenant's OAuth token (MEDIUM)
`src/lib/triage/reconcile.ts:104-107`
```ts
const { data: issueRefs } = await supabase
  .from("linear_issues")
  .select("external_id, connected_account_id")
  .in("external_id", externalIds);   // ← no .eq("user_id", userId)
```
`connByExternal` then maps to a `connected_account_id` that could belong to a
different tenant who tracks the same Linear issue, and the reconciler would use
**their** OAuth token. `userId` is in scope. Add `.eq("user_id", userId)`.

---

## Detail — auth-gate holes (T7–T9, T12–T14)

### T7 — token-decryption helper has no ownership check (MEDIUM, latent)
`getActiveAccessToken(connectionId)` (`oauth/flow.ts:153-193`) decrypts OAuth
tokens by `connectionId` on a service-role client. Every current caller verifies
ownership first (sync routes via RLS read; Slack-channels route via RLS read),
so it is safe **today**. But it is account-takeover-grade if any future caller
passes a client-supplied `connectionId` without that check. Fix: add a `userId`
parameter and `.eq("user_id", userId)` so the function self-enforces.

### T8 / T9 — LLM calls without enforced auth (MEDIUM)
- `s2d/[id]/suggest/route.ts:38-56` — `getUser()` result is never checked; runs
  `streamClaudeText` with `userId: user?.id ?? null`.
- `style/extract/route.ts:67` — `trackedCreate` runs *before* the `getUser()`
  that appears only inside the later persistence `try` (line 112).

Middleware blocks anonymous callers today, so these aren't open to the internet;
the risk is (a) no defense-in-depth if the path whitelist drifts, and (b)
unattributed spend (`ai_usage_log` NULL — see T10/T17). Fix: gate at the top of
the handler and pass `user.id` to the model call.

### T12 / T13 / T14 — routes relying solely on RLS (LOW)
`s2d/[id]/context`, `connections/[id]` (DELETE/PATCH), and
`sync/[provider]/[connectionId]` never call `getUser()`. They are correct today
because the session client enforces RLS, but they have no application-layer auth
assert and return 404/204 instead of 401 for unauthenticated/cross-user calls.
One copy-paste to a service-role client silently removes all isolation. Add an
explicit `getUser()` + ownership check to match the pattern every other route
already uses.

---

## Verified CLEAN (the attestations that make "addressed = secure" meaningful)

These were read line-by-line and found correct. Addressing the findings above
without regressing these is the bar.

- **MCP API tokens** — 256-bit random, **SHA-256 hashed at rest** (plaintext
  shown once), revocation checked on every verify, owner-only RLS, mint-time
  scope allowlist. `verifyToken` maps a token to exactly one `user_id`; tool
  execution uses that id, never tool args. (`lib/mcp/tokens.ts`, `handler.ts`)
- **All 18 MCP tool routes** — every query `.eq("user_id", ctx.userId)`.
- **All agent-thread routes + libs** (`threads.ts`, `approval.ts`, `undo.ts`,
  `compact.ts`, `inherit.ts`, `resolve.ts`, `references-server.ts`) — every
  read/write double-filtered by `user_id` (+ `thread_id`/`id`); forged
  `threadId`/`callId`/`messageId` cannot escape the `user_id` scope.
- **The four cross-user system jobs** (`consolidate`, `propagate`,
  `ai-staleness`, `bundle-meeting-items`) — each takes a single `userId`, scopes
  every query to it, and the LLM grouping keys operate only within that user's
  pre-filtered pool. No tenant mixing.
- **OAuth token encryption** — AES-256-GCM, key length validated (fail-closed),
  random 12-byte IV per call, auth tag verified on decrypt. OAuth `state` is
  192-bit, single-use, TTL-checked, `user_id`+`provider` matched (CSRF-safe).
- **Supabase Storage** — single private bucket; owner-scoped RLS keyed on
  `(storage.foldername(name))[1] = auth.uid()`; server-side download
  re-validates the `${userId}/` prefix even on the service-role client; signed
  URLs minted via the session client with UUID paths + 1h TTL. No IDOR.
- **Embeddings / vector search** — no `.rpc()` anywhere; activity-matcher
  similarity runs in-memory over `user_id`-scoped rows only. No cross-tenant
  vector path.
- **Middleware** — verifies session via `getUser()` (server round-trip), fails
  closed, cron carve-outs require `CRON_SECRET` (503 if unset).
- **`consolidate`/`reconcile`/`bundle-meetings` API routes** — `getUser()`-gated,
  per-user.
- **Secrets** — only the anon key is `NEXT_PUBLIC_*`; service-role key and
  `ENCRYPTION_KEY` are server-only; no secret logging; no raw-SQL string
  interpolation.
- **Sync inserts** — every `messages`/`meetings`/`calendar_events`/`linear_issues`
  row is built with `user_id: conn.user_id` (conflict keys include `user_id`).
- **`triage/prompts.ts`** — the old hardcoded "Sidd" is gone; `userName` is now
  a parameter from `getUserContext`.

---

## Remediation roadmap (do in this order)

**Tier 1 — close the cross-tenant breaches (small, surgical):**
1. T1/T2/T3/T4 — add `.eq("user_id", conn.user_id)` to the five Fireflies-sync
   queries (thread `userId` into `loadCloseDetectionContext`).
2. T5 — scope `loadKnownExternalIds` by `user_id`.
3. T6 — scope `reconcile.ts:104` `linear_issues` read by `user_id`.
4. T7 — give `getActiveAccessToken` a `userId` param + `.eq("user_id", …)`.

**Tier 2 — auth-gate hardening:**
5. T8/T9 — enforce auth before the LLM call; pass `user.id` to `trackedCreate`.
6. T12/T13/T14 — add explicit `getUser()` + ownership asserts to the RLS-only
   routes; return 401/404 correctly.
7. T10/T17 — make `trackedCreate` always set `user_id`; then tighten the
   `ai_usage_log` **INSERT** policy to `WITH CHECK (auth.uid() = user_id OR
   auth.uid() IS NULL)` (keeps service-role writes, blocks authed spoofing).
   SELECT is already owner-only since migration 015 — no change needed.

**Tier 3 — defense-in-depth + hygiene:**
8. T11 — strip `,()` in the agent search-tool sanitizers (match `keywords.ts`).
9. T15 — add `.eq("user_id", …)` to all `connected_accounts` status stamps.
10. T16 — verify item ownership in `getOrCreateThreadForItem`.
11. T18 — use `crypto.timingSafeEqual` for the `CRON_SECRET` check; add
    rate-limiting to LLM-invoking and auth routes.

**Tier 4 — de-hardcode (config-policy = parameterize via env):**
12. H1 — derive the viewer's email from session/profile.
13. H3/H6 — genericize Beacon example copy in prompts + UI.
14. H4/H5/H7 — move prod ref / domain / repo-owner / allowlist seed to env;
    update `.env.example`.

**Tier 5 — standing guardrail (prevents regression):**
15. `scripts/audit-tenancy.sh` in `pnpm verify` + CI: flag a service-role file
    whose query chain lacks a nearby `user_id` filter (with a
    `// tenancy-audit-ok:` carve-out), any email/domain/project-ref literal in
    `src/`, and the first-user pattern outside migrations. Plus a `pg_policies`
    assertion that fails on any non-owner-scoped policy — which also begins
    closing the live-DB-drift gap noted at the top.

---

## Bottom line

The **agent, MCP, storage, crypto, and middleware layers are genuinely solid** —
verified, not assumed. The real tenant-isolation risk is concentrated in the
**service-role sync/triage code paths**, where RLS is bypassed by design and a
handful of queries (Fireflies sync above all) dropped the `user_id` filter. Those
are confirmed cross-tenant defects, but each fix is a one-line `.eq`.

Close Tier 1–2 and you have eliminated every confirmed cross-tenant read/write
path. Add Tier 3–5 and the five residual gaps at the top (live-DB drift,
dependencies, infra/rate-limiting, pentest, audit-trail) and you are at a
defensible fintech-grade isolation posture.

---

# Addendum — Bulletproofing pass (coverage hardening)

This pass hardened the audit's own assumptions: it built the complete RLS
matrix the route verdicts depend on, mapped the browser-direct DB surface,
proved the service-role scope was complete, shipped a live-DB assertion, and
**corrected one prior finding that was based on a superseded migration.**

## Correction log (the audit is self-checking)

- **T10 was overstated and is now corrected.** The first exhaustive revision read
  migration **012** (`SELECT ... USING (auth.uid() = user_id OR user_id IS NULL)`)
  and concluded `/settings/usage` leaks cross-tenant usage rows. Migration
  **015** (`015_tighten_admin_tables.sql:36-38`) **supersedes** that — it drops
  the `OR user_id IS NULL` clause, making SELECT strictly owner-only. Verified by
  reading 015 in full. **There is no cross-tenant read of `ai_usage_log`.** The
  residual issue is the INSERT policy only (`WITH CHECK (true)` → telemetry
  spoofing / orphaned NULL rows), reflected in the corrected T10 (now LOW).
  Lesson baked into the assertion script: always evaluate a table's *final*
  policy across all migrations, never a single file.
- **`sprint_day_items` is a non-issue.** A sub-agent listed it as a missing
  browser table. It exists in neither the migrations nor the application code
  (`grep` returns zero). Sprint state lives as columns on `s2d_items`
  (`sprint_date`, `sprint_order`, `sprint_type`). No gap.

## Database RLS matrix — final state (all 45 migrations)

**Every `public` tenant table has RLS enabled and an owner-only
(`auth.uid() = user_id`) policy on all four verbs.** Verified table-by-table:

| Status | Tables |
|--------|--------|
| **Owner-only — CLEAN (31)** | companies, s2d_items, meetings, action_items, messages, drafts, calendar_events, linear_orgs, linear_issues, notifications, follow_ups, briefings, chat_sessions, chat_messages, memories, user_profile, embeddings, sprint_sessions, connected_accounts, oauth_flow_states, triage_runs, mashi_api_tokens, spotify_track_plays, activity_events, activity_suggestions, activity_settings, watch_check_ins, agent_threads, agent_messages, agent_actions, agent_approvals |
| **RLS on, zero policies — intentional lock** | `signup_allowlist` (service-role + `SECURITY DEFINER` trigger only; correct per `015`) |
| **RLS on, loose INSERT only** | `ai_usage_log` (SELECT owner-only post-015; INSERT `WITH CHECK (true)` — see T10) |
| **No RLS at all** | none |

Notes carried forward: the `create_user_profile_on_signup` trigger uses
`SET LOCAL row_security = off` (correct — `auth.uid()` is NULL at signup).
`connected_accounts`/`oauth_flow_states`/`triage_runs` have `NOT NULL user_id`
with **no** `DEFAULT auth.uid()` — correct fail-loud behavior for service-role
writes (forces explicit `user_id`), consistent with AGENTS.md invariant #1.

## Browser-direct DB surface — RLS is the SOLE control here

These tables are queried directly from the browser via the anon-key session
client (`createSupabaseBrowserClient`), with **no `user_id` filter in the
client code** — isolation is 100% RLS. All are CLEAN in the matrix above, so the
surface is safe, but it raises the stakes on never regressing those policies:

| Hook / component | Table(s) | Ops |
|------------------|----------|-----|
| `use-s2d.ts` | `s2d_items`, `companies` | read + insert (insert relies on `DEFAULT auth.uid()` + WITH CHECK) |
| `use-inbox.ts` | `messages` | read |
| `use-meetings.ts` | `meetings`, `action_items` | read |
| `use-calendar.ts` | `calendar_events` | read |
| `use-linear-issues.ts` | `linear_issues` | read |
| `usage-view.tsx` | `ai_usage_log` | read (owner-only post-015 — **no leak**) |
| `portcos-step.tsx` | `companies` | read + insert + delete |
| `sync-status-chip.tsx`, `connection-health-alert.tsx`, `context-tab.tsx` | `connected_accounts`, `messages`, `meetings`, `linear_issues` | read |

## Scope-completeness attestations (why "98 sites" is the whole surface)

- **Exactly one** service-role client constructor exists
  (`src/lib/supabase/server.ts:39`). No `createClient(... SERVICE_ROLE ...)`
  anywhere else — no rogue admin client escapes the audited inventory.
- **No `.rpc()` calls** anywhere in `src/` — no stored-procedure path that could
  bypass RLS or omit a `user_id` filter.
- **No realtime / `postgres_changes` subscriptions** — that vector does not
  exist yet (only a "coming soon" note in `onboard/sync-step.tsx:140`). When it
  is added, channel RLS must be verified.
- **One storage bucket** (`agent-attachments`), private, owner-scoped on all four
  verbs, with server-side prefix re-validation (per main report).

## Live-DB drift — now closeable

`supabase/tests/rls_assertions.sql` (shipped on this branch) runs against any
live database and (1) prints a diagnostic report of RLS-off / policy-less /
loose / missing-`user_id` tables and public buckets, then (2) **raises** on any
non-owner-only tenant table. Run it against prod/local and wire section 6 into
CI to convert the "migrations != reality" caveat into an enforced check.

## Revised bottom line

The database isolation model is **verified comprehensively**: all 31 tenant
tables owner-only, the two non-standard tables (`signup_allowlist`,
`ai_usage_log`) understood and accounted for, the browser-direct surface mapped
and clean, and the service-role/`rpc`/realtime scope proven complete. The only
DB-layer change worth making is tightening the `ai_usage_log` INSERT policy
(T10). The application-layer findings (T1–T9) stand as the real work — the
Fireflies cross-tenant cluster (T1–T3) remains the top priority.
