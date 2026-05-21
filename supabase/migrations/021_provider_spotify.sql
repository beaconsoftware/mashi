-- 021_provider_spotify.sql
--
-- Adds 'spotify' to the connected_accounts.provider CHECK constraint
-- so OAuth callback inserts don't fail with a constraint violation
-- (which Postgres throws as a PostgrestError, not a JS Error, hiding
-- the real cause behind the generic "OAuth callback failed" banner).
--
-- The original constraint was set in 002. The 006 migration extended
-- last_sync_status; this is the analogous extension for provider.
--
-- Idempotent: re-applying just rebuilds the constraint.

ALTER TABLE public.connected_accounts
  DROP CONSTRAINT IF EXISTS connected_accounts_provider_check;

ALTER TABLE public.connected_accounts
  ADD CONSTRAINT connected_accounts_provider_check
  CHECK (provider IN (
    'google',
    'gmail',
    'gcal',
    'microsoft',
    'outlook',
    'mscal',
    'slack',
    'linear',
    'fireflies',
    'granola',
    'notion',
    'spotify'
  ));
