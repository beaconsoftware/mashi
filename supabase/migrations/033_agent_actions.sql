-- 033_agent_actions.sql
--
-- Mashi Agent buildout — Phase 3 (ring-2 write tools + audit + undo).
--
-- Adds the audit ledger for every write the agent performs. Reversible
-- ring-2 writes (snooze / complete / update_item / etc.) record an
-- `undo_payload` describing what to do to reverse the change, plus an
-- `undo_expires_at` 30s in the future. Once that window passes (or the
-- user clicks Undo), the strip in the chat disappears and the action is
-- committed. Ring-3 writes (Phase 5: send_email / etc.) record their
-- rows here too but with `undo_payload IS NULL` — they're explicitly
-- approved, not optimistic, so there's no undo affordance.
--
-- The schema intentionally stores both `args` and `result` as JSONB so
-- the audit table doesn't need to evolve every time a new tool ships.
-- Per-tool reverse-op factories in src/lib/agent/undo.ts know how to
-- read an `undo_payload` and perform the inverse mutation.
--
-- Additive + idempotent per AGENTS.md migration discipline. Owner-only
-- RLS, mirroring every other tenant-scoped table.

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
  -- Reverse-operation payload. Null for irreversible writes. Tokens
  -- expire 30s after created_at and the undo API enforces the window.
  undo_payload JSONB NULL,
  undo_expires_at TIMESTAMPTZ NULL,
  undone_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_actions_thread
  ON public.agent_actions(thread_id, created_at DESC);

-- Quick lookup for "is this action still in its undo window?" — gates
-- the strip rendering on the client and the route's expiry check on
-- the server.
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
  'Audit ledger for every agent write. Ring 2 (write_mashi) records reverse-op payloads + an expiry; ring 3 (write_world) records args+result only (no undo).';

COMMENT ON COLUMN public.agent_actions.undo_payload IS
  'Per-tool reverse-op descriptor. Read by src/lib/agent/undo.ts factories to perform the inverse mutation. Null for irreversible writes.';
