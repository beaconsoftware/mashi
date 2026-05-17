-- Tighten two admin/telemetry tables that were leaking info across tenants.
--
-- 1. signup_allowlist had RLS disabled, meaning any authenticated user
--    could SELECT the entire allowlist and see what other email domains
--    are permitted to join.
--
-- 2. ai_usage_log's SELECT policy was `auth.uid() = user_id OR user_id
--    IS NULL` — pragmatic during the earlier refactor (system jobs log
--    with user_id=NULL) but it lets any user see telemetry from those
--    cross-user system jobs (purpose tags reveal what features are
--    running). Tighten to own-rows only.
--
-- Both changes are restrictive — they only DROP capabilities. Service-
-- role (trigger functions, internal jobs) is unaffected because it
-- always bypasses RLS.

-- ────────────────────────────────────────────────────────────────────
-- 1. signup_allowlist: enable RLS, no policies = no client access.
-- ────────────────────────────────────────────────────────────────────
-- The trigger function enforce_signup_allowlist() reads this table
-- via SECURITY DEFINER (postgres role bypasses RLS), so signup still
-- works. We just don't want anon/authenticated to SELECT it.
ALTER TABLE public.signup_allowlist ENABLE ROW LEVEL SECURITY;

-- Drop any leftover open policy (none expected, but defensive).
DROP POLICY IF EXISTS "authed full access" ON public.signup_allowlist;
DROP POLICY IF EXISTS "anyone read" ON public.signup_allowlist;

-- ────────────────────────────────────────────────────────────────────
-- 2. ai_usage_log: drop the OR-NULL clause from SELECT
-- ────────────────────────────────────────────────────────────────────
-- The INSERT-with-NULL-user_id pattern is still needed (some service
-- jobs log without user context). But SELECT should only return own
-- rows. The /settings/usage page already filters by user_id when
-- making the query — this just enforces it at the policy level.
DROP POLICY IF EXISTS "own usage select" ON public.ai_usage_log;
CREATE POLICY "own usage select" ON public.ai_usage_log
  FOR SELECT USING (auth.uid() = user_id);
