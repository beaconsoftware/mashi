-- ============================================================
-- 005 — AI usage tracking
--
-- Every Anthropic API call should land a row here. The /settings/usage
-- page aggregates this by purpose, model, and day to surface what's
-- actually being spent on AI.
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_usage_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- What was this call FOR (e.g. "triage:gmail", "copilot", "chat",
  -- "dedup_before_create", "ai_staleness", "consolidate", "propagate",
  -- "style_extract")
  purpose TEXT NOT NULL,

  model TEXT NOT NULL,

  -- Token counts straight from Anthropic's usage object
  input_tokens INT DEFAULT 0,
  output_tokens INT DEFAULT 0,
  cache_creation_tokens INT DEFAULT 0,
  cache_read_tokens INT DEFAULT 0,

  -- Computed USD cost using our model price table (snapshot of pricing
  -- at the time of the call — future price changes don't rewrite history)
  cost_usd NUMERIC(10, 6) DEFAULT 0,

  -- Optional context for debugging
  request_ms INT,
  error TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ai_usage_purpose_idx
  ON ai_usage_log(purpose, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_created_idx
  ON ai_usage_log(created_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_user_idx
  ON ai_usage_log(user_id, created_at DESC);

ALTER TABLE ai_usage_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authed full access" ON ai_usage_log
  FOR ALL USING (auth.role() = 'authenticated');
