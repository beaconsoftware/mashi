-- ============================================================
-- 004 — Unit of work, not unit of source
--
-- Mashi tracks WORK, not source events. A single piece of work (e.g.
-- "Update autoship parsers") may surface in Linear, Gmail, Slack, and
-- Fireflies simultaneously. We want ONE S2D row tracking that work, with
-- multiple source signals attached — not four duplicate rows.
--
-- linked_sources holds additional source signals beyond the primary
-- (source_type / source_id / source_thread_id / source_label) that
-- originally created the row.
-- ============================================================

ALTER TABLE s2d_items
  ADD COLUMN IF NOT EXISTS linked_sources JSONB DEFAULT '[]'::jsonb;

-- Useful index for finding items that have multi-source coverage
CREATE INDEX IF NOT EXISTS s2d_linked_sources_idx
  ON s2d_items USING gin (linked_sources);
