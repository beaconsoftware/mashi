-- Sprint performance tracking
--
-- Each completed (or abandoned) sprint becomes one row here. We
-- persist enough to compute aggregate metrics over time without
-- having to walk s2d_items history.
--
-- Multi-tenancy invariants per AGENTS.md:
--   - user_id is NOT NULL DEFAULT auth.uid()
--   - RLS enabled, owner-only USING + WITH CHECK
--   - Service-role writes (e.g. background jobs that finalize a sprint)
--     must set user_id explicitly because auth.uid() resolves to NULL
--     under service-role.

CREATE TABLE IF NOT EXISTS public.sprint_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Wall-clock bookends.
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,

  -- Snapshot of what got planned at start. JSONB array of
  -- { s2d_item_id, title, pathway, priority, est_minutes }.
  planned_items JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Per-item outcome at the end. JSONB array of
  -- { s2d_item_id, status: 'done'|'skipped', actual_min }.
  results JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Pre-computed aggregates (cheap reads in the UI without re-walking
  -- the JSONB blobs).
  planned_count INT NOT NULL DEFAULT 0,
  done_count INT NOT NULL DEFAULT 0,
  skipped_count INT NOT NULL DEFAULT 0,
  total_planned_min INT NOT NULL DEFAULT 0,
  total_actual_min INT NOT NULL DEFAULT 0,

  -- Optional theme / notes the user set when planning.
  theme TEXT,
  notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sprint_sessions_user_started_idx
  ON public.sprint_sessions (user_id, started_at DESC);

-- RLS owner-only.
ALTER TABLE public.sprint_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sprint_sessions owner-only select" ON public.sprint_sessions;
CREATE POLICY "sprint_sessions owner-only select"
  ON public.sprint_sessions FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "sprint_sessions owner-only insert" ON public.sprint_sessions;
CREATE POLICY "sprint_sessions owner-only insert"
  ON public.sprint_sessions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "sprint_sessions owner-only update" ON public.sprint_sessions;
CREATE POLICY "sprint_sessions owner-only update"
  ON public.sprint_sessions FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "sprint_sessions owner-only delete" ON public.sprint_sessions;
CREATE POLICY "sprint_sessions owner-only delete"
  ON public.sprint_sessions FOR DELETE
  USING (auth.uid() = user_id);

-- Keep updated_at fresh on update.
CREATE OR REPLACE FUNCTION public.touch_sprint_sessions_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sprint_sessions_touch_updated_at ON public.sprint_sessions;
CREATE TRIGGER sprint_sessions_touch_updated_at
  BEFORE UPDATE ON public.sprint_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_sprint_sessions_updated_at();
