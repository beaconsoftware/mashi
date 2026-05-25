-- 024_drop_sprint_start_status_constraint.sql
--
-- 023 added s2d_items_sprint_start_status which required
-- sprint_start_at to be NULL unless status IN ('todo','in_progress','done').
-- The invariant turned out to be too restrictive in practice — when a
-- user delegates / parks / drops an item that was previously scheduled
-- into a sprint, the sprint_start_at timestamp lives on as a historical
-- record. Forcing it to NULL on every transition would lose information
-- the sprint/history surfaces rely on; forcing the status to stay in
-- the actionable set blocks legitimate user moves (the user-reported
-- bug: "Track as delegated" rejected by the DB on items with a sprint
-- timestamp).
--
-- Drop the CHECK. The other four E5 invariants (B5 review/in_progress
-- exclusion, done<->done_at consistency, in_queue requires queue_reason,
-- C3 suggestion-target trigger) stay in place; they encode shape rules
-- the app actually maintains.
--
-- Idempotent: DROP CONSTRAINT IF EXISTS.

ALTER TABLE public.s2d_items
  DROP CONSTRAINT IF EXISTS s2d_items_sprint_start_status;
