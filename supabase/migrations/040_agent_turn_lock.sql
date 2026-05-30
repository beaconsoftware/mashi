-- 040_agent_turn_lock.sql
--
-- Mashi Agent buildout — A1 (per-thread turn lock + ordered replay).
--
-- Two latent data-integrity defects in the agent loop:
--
--   1. Nothing serializes turns on a thread. Two tabs, a double-send, or
--      a retry can interleave message-row inserts; replay then mis-pairs
--      tool_use / tool_result blocks and Anthropic 400s (or worse, the
--      agent acts on a silently corrupted history).
--   2. Message rows are ordered solely by created_at, with no tiebreaker.
--      Two inserts in the same millisecond order nondeterministically.
--
-- This migration adds:
--   - agent_messages.seq: a monotonic per-insert sequence used as the
--     deterministic tiebreaker behind created_at, so replay is totally
--     ordered.
--   - agent_threads.active_turn_id / active_turn_started_at: a thread-
--     level claim. The loop conditionally claims the single in-flight
--     turn slot (free OR stale past a TTL) before streaming; a second
--     concurrent turn fails the claim and the route 409s. started_at
--     drives the TTL so a crashed turn can't wedge a thread forever.
--
-- Additive + idempotent per AGENTS.md migration discipline. No backfill
-- ordering guarantee for pre-existing rows is needed: seq is only a
-- tiebreaker behind created_at, and agent_messages is append-only so
-- heap order already approximates insertion order for old rows.

-- 1. Deterministic ordering tiebreaker. BIGSERIAL creates the backing
--    sequence + NOT NULL default; ADD COLUMN IF NOT EXISTS skips the
--    whole statement (sequence included) on re-run.
ALTER TABLE public.agent_messages
  ADD COLUMN IF NOT EXISTS seq BIGSERIAL;

CREATE INDEX IF NOT EXISTS idx_agent_messages_thread_seq
  ON public.agent_messages(thread_id, created_at, seq);

COMMENT ON COLUMN public.agent_messages.seq IS
  'Monotonic per-insert sequence. Used as the deterministic tiebreaker behind created_at so turn replay is totally ordered and never mis-pairs tool_use/tool_result blocks (A1).';

-- 2. Per-thread turn lock. NULL active_turn_id == thread is free.
ALTER TABLE public.agent_threads
  ADD COLUMN IF NOT EXISTS active_turn_id UUID NULL;

ALTER TABLE public.agent_threads
  ADD COLUMN IF NOT EXISTS active_turn_started_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.agent_threads.active_turn_id IS
  'Claim token for the single in-flight turn on this thread (A1). NULL means free. Set by claimThreadTurn before streaming and cleared in the loop finally. A second concurrent turn fails the conditional claim and the route returns 409.';

COMMENT ON COLUMN public.agent_threads.active_turn_started_at IS
  'When the active turn claimed the thread. Drives the claim TTL (matches the route maxDuration) so a crashed turn that never releases the lock cannot wedge the thread permanently.';
