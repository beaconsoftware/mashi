-- Scope external_id uniqueness by user_id.
--
-- The original constraints (e.g. `meetings_external_id_key UNIQUE
-- (external_id)`) are GLOBAL — they prevent two rows in the entire
-- database from sharing an external_id. That breaks multi-tenancy when
-- two users sync the same source (e.g. shared Linear workspaces at MAP):
-- one user's row blocks the other's, and the data migration to push
-- local data to prod fails for the 151 linear_issues whose external_ids
-- happen to overlap with another tenant.
--
-- The right shape: external_id is unique PER USER, not globally. Drop the
-- old single-column unique constraints, replace with composite ones on
-- (external_id, user_id). Same dedup behavior within a user's data;
-- no cross-tenant interference.
--
-- Idempotent: uses IF EXISTS / IF NOT EXISTS so re-applies cleanly.

-- meetings
ALTER TABLE public.meetings DROP CONSTRAINT IF EXISTS meetings_external_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS meetings_user_external_id_key
  ON public.meetings (user_id, external_id);

-- calendar_events
ALTER TABLE public.calendar_events DROP CONSTRAINT IF EXISTS calendar_events_external_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS calendar_events_user_external_id_key
  ON public.calendar_events (user_id, external_id);

-- messages
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_external_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS messages_user_external_id_key
  ON public.messages (user_id, external_id);

-- linear_issues
ALTER TABLE public.linear_issues DROP CONSTRAINT IF EXISTS linear_issues_external_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS linear_issues_user_external_id_key
  ON public.linear_issues (user_id, external_id);
