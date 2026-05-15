-- ============================================================
-- 003 — Triage v1: source-unit grouping
--
-- v0 triage created one S2D item per message. v1 triages at the unit of
-- work that actually matters: a Gmail thread, a Slack daily slice, a
-- Fireflies meeting, a Linear issue. Each unit can produce multiple S2D
-- items, AND a triage pass can close/update existing items in the unit.
--
-- We add source_thread_id as the grouping key. The agent uses it to look
-- up existing open items for a given unit before deciding what's new vs
-- what needs to be updated/closed.
-- ============================================================

ALTER TABLE s2d_items
  ADD COLUMN IF NOT EXISTS source_thread_id TEXT;

CREATE INDEX IF NOT EXISTS s2d_source_thread_idx
  ON s2d_items(source_type, source_thread_id);

-- Triage runs: log of every triage agent call. Useful for debugging,
-- auditing, and showing "Mashi processed N threads in X seconds" in UI.
CREATE TABLE IF NOT EXISTS triage_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  connected_account_id UUID REFERENCES connected_accounts(id) ON DELETE SET NULL,
  source_type TEXT NOT NULL,
  source_unit_id TEXT NOT NULL,
  model TEXT NOT NULL,
  operations JSONB NOT NULL DEFAULT '[]',
  input_summary JSONB,
  created_count INT DEFAULT 0,
  updated_count INT DEFAULT 0,
  closed_count INT DEFAULT 0,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS triage_runs_source_idx
  ON triage_runs(source_type, source_unit_id, created_at DESC);

ALTER TABLE triage_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own triage runs" ON triage_runs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
