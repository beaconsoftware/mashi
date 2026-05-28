-- 038_agent_thread_mode.sql
--
-- Mashi Agent Quality Upgrade — Phase 3 (Plan/Act mode).
--
-- Adds a per-thread mode column. In `plan` mode the agent loop filters
-- out ring-2/3 tools so the model can only read and ask follow-ups; the
-- user toggles via the chat header to switch to `act` and execute.
-- Default `act` keeps existing thread behavior unchanged.
--
-- Additive + idempotent per AGENTS.md migration discipline.

ALTER TABLE public.agent_threads
  ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'act'
    CHECK (mode IN ('plan', 'act'));

COMMENT ON COLUMN public.agent_threads.mode IS
  'Plan/act mode per Phase 3 of the agent quality upgrade. In plan mode the agent loop filters out ring-2/3 tools, so the model can only read and ask follow-ups. User toggles via the chat header.';
