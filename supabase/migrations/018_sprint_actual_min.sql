-- 018_sprint_actual_min.sql
--
-- Per-item actual focused minutes from the most recent sprint.
-- Stamped from /api/sprint/finalize-events when a sprint completes.
-- The sprint_sessions table already aggregates totals across items;
-- this column gives the board itself a "you spent Xm here" signal
-- without needing to JOIN through sessions.results JSONB.
--
-- Idempotent: re-applying this migration is a no-op via IF NOT EXISTS.

ALTER TABLE public.s2d_items
  ADD COLUMN IF NOT EXISTS sprint_actual_min INTEGER;

COMMENT ON COLUMN public.s2d_items.sprint_actual_min IS
  'Actual focused minutes from the most recent sprint where this item ran. Set by /api/sprint/finalize-events at sprint complete. Per-item, not cumulative — overwritten each sprint.';
