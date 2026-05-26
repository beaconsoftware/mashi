-- 032_agent_threads.sql
--
-- Mashi Agent buildout — Phase 1 (foundations).
--
-- Adds persistent agent conversations. One thread per item is the rule
-- (enforced by a unique partial index on item_id); the existing per-
-- sprint enriched_context.thread field is left untouched and will be
-- migrated to point at agent_threads in a later phase.
--
-- agent_threads carries a rolling agent-written summary so a long
-- conversation can be loaded with bounded prompt size (Phase 6
-- introduces the compaction generator that writes the summary).
--
-- agent_messages stores every turn: user / assistant / system / tool.
-- tool_calls + tool_results are stored as JSONB to keep the schema
-- stable while the agent's tool catalogue grows. cursor_context is a
-- snapshot of what the user was looking at when they typed the turn,
-- so future replay / debugging has the same orientation the agent had.
--
-- Additive + idempotent per AGENTS.md migration discipline. RLS
-- owner-only, mirroring every other tenant-scoped table.

CREATE TABLE IF NOT EXISTS public.agent_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT auth.uid()
    REFERENCES auth.users(id) ON DELETE CASCADE,
  item_id UUID NULL REFERENCES public.s2d_items(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  summary TEXT NULL,
  last_message_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One thread per item — re-entries append to the same thread rather than
-- branching. Partial index allows multiple orphan (item_id IS NULL)
-- threads to coexist (Spotlight chats before they're bound to an item).
CREATE UNIQUE INDEX IF NOT EXISTS agent_threads_one_per_item
  ON public.agent_threads(item_id) WHERE item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_threads_user_recent
  ON public.agent_threads(user_id, last_message_at DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS public.agent_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT auth.uid()
    REFERENCES auth.users(id) ON DELETE CASCADE,
  thread_id UUID NOT NULL REFERENCES public.agent_threads(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system','tool')),
  content TEXT NULL,
  tool_calls JSONB NULL,
  tool_results JSONB NULL,
  cursor_context JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_messages_thread
  ON public.agent_messages(thread_id, created_at);

ALTER TABLE public.agent_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_messages ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'agent_threads'
      AND policyname = 'agent_threads_owner'
  ) THEN
    CREATE POLICY agent_threads_owner ON public.agent_threads
      FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'agent_messages'
      AND policyname = 'agent_messages_owner'
  ) THEN
    CREATE POLICY agent_messages_owner ON public.agent_messages
      FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

COMMENT ON TABLE public.agent_threads IS
  'Persistent agent conversations. One thread per item via the partial unique index; orphan (item_id NULL) threads are Spotlight chats not yet bound to an item.';

COMMENT ON COLUMN public.agent_threads.summary IS
  'Rolling agent-written summary of older turns. Refreshed when the thread crosses ~8k tokens (Phase 6 compaction). Injected as a system message on every turn so prompt size stays bounded.';

COMMENT ON TABLE public.agent_messages IS
  'Every turn in an agent_thread. tool_calls/tool_results JSONB blobs keep the schema stable while the tool registry evolves. cursor_context snapshots what the user was looking at when they sent the turn.';
