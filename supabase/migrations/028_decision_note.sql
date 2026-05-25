-- 028_decision_note.sql
--
-- Sprint Card v2 — Section 3 "Decide" tab persistence.
--
-- When the user makes a decision on an item (especially decision_gate
-- pathway), they record a short note explaining the call. The note is
-- preserved on the item independent of the description so future-self
-- can trace WHY the item closed, separately from WHAT the work was.
--
-- An optional follow-up item is created elsewhere (via the existing
-- s2d_items.insert path) — this migration only adds the columns the
-- current item needs.
--
-- Additive + idempotent per AGENTS.md migration discipline.

ALTER TABLE public.s2d_items
  ADD COLUMN IF NOT EXISTS decision_note TEXT;

ALTER TABLE public.s2d_items
  ADD COLUMN IF NOT EXISTS decision_at TIMESTAMPTZ;

COMMENT ON COLUMN public.s2d_items.decision_note IS
  'User-recorded decision for this item (set via the Decide tab in the sprint card). Free-form prose. Distinct from description (which describes WHAT) — this captures WHY a particular call was made.';

COMMENT ON COLUMN public.s2d_items.decision_at IS
  'Timestamp of the most recent decision_note write. NULL when no decision has been recorded.';
