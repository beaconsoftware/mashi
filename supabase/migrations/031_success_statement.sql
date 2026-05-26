-- 031_success_statement.sql
--
-- Sprint Focus redesign — Phase 5 (Contract card + sprint-complete recap).
--
-- The contract card (rendered between planner-schedule and the takeover)
-- asks the user to commit to a one-line success statement per item:
-- "At the end of this sprint you will have…" Mashi pre-fills via the
-- success-statement LLM helper; the user can edit. The string persists
-- on s2d_items.success_statement and surfaces in the sprint-complete
-- recap (alongside the actual outcome) and any future post-mortem views.
--
-- Additive + idempotent per AGENTS.md migration discipline.

ALTER TABLE public.s2d_items
  ADD COLUMN IF NOT EXISTS success_statement TEXT NULL;

COMMENT ON COLUMN public.s2d_items.success_statement IS
  'Set at the contract card; surfaces in sprint-complete recap.';
