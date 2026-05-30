-- P4.b (Epic E1) — per-tool approval policy.
--
-- Today every ring-3 (write_world) call gates the same way: a fresh
-- agent_approvals row + a blocking card, every single time. There is no
-- "always allow draft_email to myself" and no "never let the agent send
-- Slack". This table is the remembered policy the ring-3 hook consults
-- BEFORE it creates an approval:
--
--   never        -> deny without a card (audited as blocked)
--   always_allow -> proceed without a card (still audited by the post-tool
--                   hook, so there is a trail of every policy-bypassed write)
--   ask          -> current behaviour (create the approval, show the card)
--
-- Scope keeps always_allow narrow per the privacy doctrine: a row scopes to
-- a derived key (e.g. 'channel:C0123456', 'to:maya@portco.com') or the '*'
-- wildcard. The most specific match wins. The application layer also refuses
-- to honour an always_allow on an irreversible SEND (send_email /
-- send_slack_message / comment_on_linear_issue) as defence in depth, so a
-- stale over-broad row can never silently fire a one-way message to a human.
--
-- Additive + idempotent: safe to re-run. Owner-only RLS mirrors
-- agent_approvals (034).

CREATE TABLE IF NOT EXISTS public.agent_tool_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT auth.uid()
    REFERENCES auth.users(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  -- Derived narrow scope key, or '*' for any args. See scopeForCall in
  -- src/lib/agent/policy.ts for the per-tool derivation.
  scope TEXT NOT NULL DEFAULT '*',
  mode TEXT NOT NULL DEFAULT 'ask'
    CHECK (mode IN ('always_allow','ask','never')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One policy per (user, tool, scope) so the inline "always allow this"
-- affordance and the settings editor both upsert rather than duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS agent_tool_policies_user_tool_scope
  ON public.agent_tool_policies(user_id, tool_name, scope);

ALTER TABLE public.agent_tool_policies ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'agent_tool_policies'
      AND policyname = 'agent_tool_policies_owner'
  ) THEN
    CREATE POLICY agent_tool_policies_owner ON public.agent_tool_policies
      FOR ALL USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END
$$;
