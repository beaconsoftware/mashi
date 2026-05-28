-- 039_user_mashi_md.sql
--
-- Mashi Agent Quality Upgrade — Phase 5 (MASHI.md per-user memory).
--
-- Adds a free-text memory column on user_profile. The agent loop reads
-- this on every turn and prepends a user-role message after the system
-- prompt so directives like "always call me Sidd" or "I manage MPP,
-- Snailworks, Beacon SW" survive compaction and persist across threads.
-- Edited from /settings/style. 8000-char limit enforced at the API
-- layer (not in the DB so future bumps don't need a migration).
--
-- Additive + idempotent per AGENTS.md migration discipline.

ALTER TABLE public.user_profile
  ADD COLUMN IF NOT EXISTS mashi_md TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN public.user_profile.mashi_md IS
  'Per-user memory file injected into every agent turn as a user-role message after the system prompt. Edited from /settings/style. Survives compaction by being re-read every turn. Max ~8000 chars enforced at the API layer.';
