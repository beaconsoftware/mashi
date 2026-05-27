-- 035_thread_compaction.sql
--
-- Mashi Agent buildout — Phase 6 (thread compaction + spawn-chain inheritance).
--
-- Long agent threads need to load fast and stay within prompt budget.
-- When a thread crosses ~8k tokens of message content, the compaction
-- generator (src/lib/agent/compact.ts) writes a rolling summary into
-- agent_threads.summary and stamps all-but-the-last-20 messages with
-- superseded_by_summary_at. The loop loads only non-superseded rows on
-- subsequent turns; the summary is injected as a system block so the
-- prompt stays bounded.
--
-- Additive + idempotent per AGENTS.md migration discipline. The partial
-- index keeps the loop's "non-superseded only" replay scan cheap.

ALTER TABLE public.agent_messages
  ADD COLUMN IF NOT EXISTS superseded_by_summary_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_agent_messages_active
  ON public.agent_messages(thread_id, created_at)
  WHERE superseded_by_summary_at IS NULL;
