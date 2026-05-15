-- Per-item AI justification for the review swipe deck.
--
-- When triage creates an S2D item it picks a pathway + priority based on
-- the source content. The Review deck shows the user one card at a time,
-- and each card needs a 1-2 sentence "here's WHY I picked this priority"
-- so the user can swipe-approve confidently.
--
-- Stored on the row so we generate the justification once (at create
-- time) and never re-pay for it.

ALTER TABLE s2d_items
  ADD COLUMN IF NOT EXISTS review_justification TEXT;
