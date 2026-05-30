-- P6.b (Epic F2) — Playbooks: user-authored, parameterized, multi-step
-- procedures the agent runs step by step with the normal approval gates.
--
-- Built-in starter playbooks live in code (BUILTIN_PLAYBOOKS in
-- src/lib/agent/playbooks.ts); this table holds the user's OWN playbooks.
-- The trigger surface (Spotlight "Playbooks" tab) merges built-ins with the
-- rows below for display. Triggering a playbook composes a single user-turn
-- prompt and sends it through the existing agent loop — no server-side
-- execution state lives here, so this is just the saved definition.
--
-- Multi-tenancy: owner-only RLS, all verbs, mirroring agent_tool_policies
-- (046). The Spotlight tab reads this table directly through the browser
-- client, so RLS is the control (foundation invariant #7) — and the API
-- route additionally scopes every write by user_id explicitly.
--
-- Additive + idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS public.agent_playbooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT auth.uid()
    REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  -- Lowercase hyphenated slug derived from the name (slugify in playbooks.ts).
  -- Unique per user so the create form upserts rather than duplicates.
  slug TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  -- Ordered list of PlaybookParam ({ key, label, placeholder?, required? }).
  params JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Ordered list of natural-language step strings (may contain {{param}}).
  steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_playbooks_user_slug
  ON public.agent_playbooks(user_id, slug);

CREATE INDEX IF NOT EXISTS agent_playbooks_user_created
  ON public.agent_playbooks(user_id, created_at DESC);

ALTER TABLE public.agent_playbooks ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'agent_playbooks'
      AND policyname = 'agent_playbooks_owner'
  ) THEN
    CREATE POLICY agent_playbooks_owner ON public.agent_playbooks
      FOR ALL USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END
$$;
