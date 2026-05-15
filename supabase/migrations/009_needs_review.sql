-- Triage review queue.
--
-- Every AI-triaged item now lands in a "Review" pseudo-column before
-- joining the actual board. The user approves it (optionally adjusting
-- priority/pathway/etc) before it goes anywhere.
--
-- Why a flag and not a status: the agent's status recommendation (todo /
-- backlog / in_queue) is preserved — `needs_review` just gates whether
-- it's visible in that column yet. On approve, flip the flag off and the
-- item lands in its recommended column.
--
-- Manual creates default to needs_review=false (user is already deciding
-- by clicking + on a specific column). AI creates default to true.

ALTER TABLE s2d_items
  ADD COLUMN IF NOT EXISTS needs_review BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS s2d_needs_review_idx
  ON s2d_items (needs_review)
  WHERE needs_review = true;
