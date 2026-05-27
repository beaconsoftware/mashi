-- Phase 5: per-call approval gate for ring-3 (write_world) agent tools.
--
-- The agent loop runs inside an SSE-streaming HTTP request. The user's
-- approve/edit/cancel decision arrives on a SEPARATE HTTP request. The
-- two are stitched together through this table: the loop inserts a
-- 'pending' row, polls until status flips, then resumes.
--
-- Rows expire 5 minutes after creation. The streaming route caps its
-- maxDuration at 300s so a stalled approval naturally times out at the
-- request boundary too.

CREATE TABLE IF NOT EXISTS public.agent_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT auth.uid()
    REFERENCES auth.users(id) ON DELETE CASCADE,
  thread_id UUID NOT NULL REFERENCES public.agent_threads(id) ON DELETE CASCADE,
  -- Anthropic tool_use_id ("toolu_…"). The client uses it to POST a
  -- decision back to /approvals/[callId]; the loop polls by it.
  call_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  args JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','edited','cancelled','expired')),
  edited_args JSONB NULL,
  decided_at TIMESTAMPTZ NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '5 minutes'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_approvals_thread_call
  ON public.agent_approvals(thread_id, call_id);

CREATE INDEX IF NOT EXISTS agent_approvals_pending
  ON public.agent_approvals(user_id, status, expires_at)
  WHERE status = 'pending';

ALTER TABLE public.agent_approvals ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'agent_approvals'
      AND policyname = 'agent_approvals_owner'
  ) THEN
    CREATE POLICY agent_approvals_owner ON public.agent_approvals
      FOR ALL USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END
$$;
