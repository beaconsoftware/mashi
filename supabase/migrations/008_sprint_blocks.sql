-- Sprint planner — time-blocked work sessions.
--
-- The old `sprint_date` + `sprint_type` columns (morning/midday/afternoon)
-- were too coarse for the new planner. The new flow lets the user assign
-- specific start times and durations to items, optionally creating
-- matching Google Calendar events. Both legacy fields stay for the
-- existing daily-sprint UI; new fields layer on top.

ALTER TABLE s2d_items
  ADD COLUMN IF NOT EXISTS sprint_start_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sprint_end_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sprint_calendar_event_id TEXT,
  ADD COLUMN IF NOT EXISTS sprint_calendar_account_id UUID;

CREATE INDEX IF NOT EXISTS s2d_sprint_start_idx
  ON s2d_items (sprint_start_at)
  WHERE sprint_start_at IS NOT NULL;
