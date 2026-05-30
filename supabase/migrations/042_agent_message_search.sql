-- 042_agent_message_search.sql
--
-- Mashi Agent buildout — P2.b (conversation control: D2/D3/D4).
--
-- Two additive changes to agent_messages:
--
--   1. `deleted_at` — soft-delete marker for the truncation that backs
--      Regenerate (D2) and Edit-and-resend (D3). Re-running a turn
--      discards the assistant + tool rows after the target user message,
--      but we never hard-delete: the rows stay for auditability and are
--      simply excluded from replay, the thread view, and search. NULL for
--      every live message.
--
--   2. `content_tsv` — a generated tsvector over `content`, plus a GIN
--      index, powering cross-thread transcript search (D4). Owner-only
--      RLS already covers the table (032), so search via the session
--      client is automatically scoped to the current user; the route adds
--      an explicit user_id filter as belt-and-suspenders.
--
-- Additive + idempotent per AGENTS.md migration discipline. The generated
-- column uses the 2-arg to_tsvector(regconfig, text) form because it must
-- be IMMUTABLE — the 1-arg form depends on the session's default text
-- search config and is only STABLE, which Postgres rejects for a STORED
-- generated column.

ALTER TABLE public.agent_messages
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;

ALTER TABLE public.agent_messages
  ADD COLUMN IF NOT EXISTS content_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce(content, ''))) STORED;

CREATE INDEX IF NOT EXISTS idx_agent_messages_content_tsv
  ON public.agent_messages USING GIN (content_tsv);

-- Replay / load / search all filter on (thread_id, deleted_at). A partial
-- index over the live rows keeps the common "load this thread" path fast
-- once a thread accumulates soft-deleted history from repeated re-runs.
CREATE INDEX IF NOT EXISTS idx_agent_messages_thread_live
  ON public.agent_messages(thread_id, created_at)
  WHERE deleted_at IS NULL;

COMMENT ON COLUMN public.agent_messages.deleted_at IS
  'Soft-delete marker for Regenerate/Edit-and-resend truncation (P2.b). Rows are kept for auditability but excluded from replay, the thread view, and search. NULL for live messages.';

COMMENT ON COLUMN public.agent_messages.content_tsv IS
  'Generated english tsvector over content for cross-thread transcript search (P2.b D4). GIN-indexed. Owner-only RLS scopes search to the current user.';
