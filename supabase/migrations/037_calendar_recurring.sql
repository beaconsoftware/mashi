-- 037_calendar_recurring.sql
--
-- Capture Google Calendar's recurringEventId on each event instance so
-- the triage orchestrator can tell cadence meetings (Iteration Planning,
-- weekly 1:1s, sprint retros) apart from one-off invites. The
-- meeting-only noise filter at src/lib/triage/orchestrator.ts treats
-- every calendar-sourced create as noise without cross-source
-- corroboration, which is wrong for recurring meetings where the prep
-- IS the work and no Gmail thread will ever land.

ALTER TABLE public.calendar_events
  ADD COLUMN IF NOT EXISTS recurring_event_id TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_calendar_events_recurring
  ON public.calendar_events(recurring_event_id)
  WHERE recurring_event_id IS NOT NULL;

COMMENT ON COLUMN public.calendar_events.recurring_event_id IS
  'Google Calendar recurringEventId — pointer to the master recurring event series. NULL for one-off events. The triage orchestrator bypasses the meeting-only noise filter when this is set, so cadence meetings (Iteration Planning, weekly 1:1s, etc.) can land on the S2D board even without cross-source corroboration.';
