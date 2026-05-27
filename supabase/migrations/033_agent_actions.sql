-- 033_agent_actions.sql
--
-- Mashi Agent buildout — Phase 3 (ring 2 write tools).
--
-- Every agent-initiated write (Mashi-internal or external) records to
-- agent_actions. Ring 2 (write_mashi) calls also stash a reverse-
-- operation payload + a 30s expiry; the in-chat undo strip POSTs to
-- /api/agent/undo with the action id, the server checks the expiry
-- and applies the reverse op, and stamps undone_at so the model knows
-- the action is no longer in force.
--
-- Ring 3 (write_world) calls record here too, but with NULL undo_payload
-- — outbound sends are explicitly approved, not optimistically applied,
-- and they're not reversible from our side (a sent email is sent).
--
-- Additive + idempotent per AGENTS.md migration discipline. RLS
-- owner-only, mirroring every other tenant-scoped table.

CREATE TABLE IF NOT EXISTS public.agent_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT auth.uid()
    REFERENCES auth.users(id) ON DELETE CASCADE,
  thread_id UUID NULL REFERENCES public.agent_threads(id) ON DELETE SET NULL,
  tool_name TEXT NOT NULL,
  ring TEXT NOT NULL CHECK (ring IN ('write_mashi','write_world')),
  args JSONB NOT NULL,
  result JSONB NULL,
  ok BOOLEAN NOT NULL,
  -- Reverse-operation payload — what we'd run to undo this. Null for
  -- irreversible writes (ring 3 sends, merge of N>1 items, etc.).
  -- Tokens expire 30s after created_at; the API enforces.
  undo_payload JSONB NULL,
  undo_expires_at TIMESTAMPTZ NULL,
  undone_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_actions_thread
  ON public.agent_actions(thread_id, created_at DESC);

-- Pending-undo lookups happen by (id, user_id) at undo-time, but the
-- partial index keeps housekeeping queries cheap if we ever sweep
-- expired tokens.
CREATE INDEX IF NOT EXISTS idx_agent_actions_undo
  ON public.agent_actions(undo_expires_at)
  WHERE undone_at IS NULL AND undo_payload IS NOT NULL;

ALTER TABLE public.agent_actions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'agent_actions'
      AND policyname = 'agent_actions_owner'
  ) THEN
    CREATE POLICY agent_actions_owner ON public.agent_actions
      FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

COMMENT ON TABLE public.agent_actions IS
  'Audit row for every agent-initiated write. Ring 2 (write_mashi) rows carry a 30s reversible undo_payload; ring 3 (write_world) rows record the outbound send for history but have no undo path.';

COMMENT ON COLUMN public.agent_actions.undo_payload IS
  'JSONB describing the reverse operation. Shape is tool-specific (e.g. snooze undo: { kind: "update_item", id, patch: { status: prior_status, snoozed_until: prior_snooze } }). Applied by /api/agent/undo.';
