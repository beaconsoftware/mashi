-- Surface AI-driven updates to existing S2D items.
--
-- Today the triage agent silently mutates open items when new signals
-- (meetings, emails, Slack) arrive. The user has no way to tell that a
-- ticket they triaged last week now has new information.
--
-- has_unseen_updates flips to true whenever an update/reconcile/bundle
-- pass changes the content of an existing row. last_update_summary is
-- a one-sentence "what changed" written by the triage agent (mapped from
-- its TriageUpdateOp.reason field), shown in the detail sheet callout
-- and the top-bar notification hub.
--
-- Clearing is user-driven: opening the detail sheet auto-clears after a
-- 2s pulse, or the user can hit "Mark read" explicitly.

ALTER TABLE s2d_items
  ADD COLUMN IF NOT EXISTS has_unseen_updates BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_update_summary TEXT,
  ADD COLUMN IF NOT EXISTS last_update_at TIMESTAMPTZ;

-- Hub query reads `where has_unseen_updates = true order by last_update_at desc`.
CREATE INDEX IF NOT EXISTS idx_s2d_items_unseen_updates
  ON s2d_items (last_update_at DESC)
  WHERE has_unseen_updates = true;
