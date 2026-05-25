-- 024_planned_for.sql
--
-- Daily planning "Today" tag.
--
-- Adds a single nullable date column `planned_for` to s2d_items. Set when
-- the user uses the board's Select mode to plan a set of items for a
-- specific day. Read by the card chrome (renders a "Today" or "Overdue"
-- badge) and by the sprint planner (sorts planned items to the top).
--
-- The badge state is pure date math at render time:
--   - planned_for = current_date AND status != 'done' → "Today"
--   - planned_for = current_date - 1 AND status != 'done' → "Overdue"
--   - older or absent → no badge (data persists for analytics — daily
--     recap can still measure "you planned 8, shipped 6, 2 went overdue")
--
-- No nightly job, no rollover. The column is just a stamp; rendering
-- decides what to do with it. Late-shipped items keep the stamp so the
-- daily-recap join can see "shipped late but shipped".
--
-- Additive + idempotent per AGENTS.md. No backfill needed; null means
-- "not planned for any day", which is the only meaningful pre-state.

ALTER TABLE public.s2d_items
  ADD COLUMN IF NOT EXISTS planned_for DATE;

-- Index supports the daily-recap join and the sprint-planner sort
-- (WHERE planned_for >= current_date - 1). Partial so we don't carry the
-- index weight for the long tail of unplanned items.
CREATE INDEX IF NOT EXISTS s2d_items_planned_for_recent_idx
  ON public.s2d_items (user_id, planned_for)
  WHERE planned_for IS NOT NULL;

COMMENT ON COLUMN public.s2d_items.planned_for IS
  'The calendar day (in user-local interpretation) the user planned this item for. NULL = not planned. Set via the board Select-mode "Add to Today" action. The badge state (Today / Overdue / hidden) is computed at render time from this + status.';
