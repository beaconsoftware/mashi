-- Activity Watcher — Phase 1 storage.
--
-- See docs/prd-laptop-activity-watcher.md for the spec. In short:
--   - activity_events: raw signal log from Mac helper / browser ext / cloud
--     feeders. 7-day TTL (cleaned by /api/activity/maintenance Vercel cron,
--     since pg_cron isn't enabled on this project).
--   - activity_suggestions: gated state-change proposals. The ONLY path to
--     an s2d_items state change is a confirmed row here. Never auto-applied.
--
-- Additive + idempotent. Safe to re-run.

-- =========================================================================
-- activity_events — raw heartbeat signals
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.activity_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid(),
  source        TEXT NOT NULL
                  CHECK (source IN ('mac_helper', 'browser_ext', 'cloud')),
  surface       TEXT NOT NULL,
  identifier    TEXT,
  title         TEXT,
  app           TEXT,
  url           TEXT,
  signal_kind   TEXT NOT NULL
                  CHECK (signal_kind IN ('open', 'focus', 'close', 'merge', 'archive', 'idle_end')),
  started_at    TIMESTAMPTZ NOT NULL,
  ended_at      TIMESTAMPTZ,
  client_id     UUID NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS activity_events_user_started_idx
  ON public.activity_events (user_id, started_at DESC);

CREATE INDEX IF NOT EXISTS activity_events_user_identifier_idx
  ON public.activity_events (user_id, identifier)
  WHERE identifier IS NOT NULL;

ALTER TABLE public.activity_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own activity_events" ON public.activity_events;
CREATE POLICY "own activity_events" ON public.activity_events
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- =========================================================================
-- activity_suggestions — the queue users actually see
-- =========================================================================
--
-- Lifecycle:
--   pending     — created by matcher, awaiting user decision
--   confirmed   — user clicked Yes; s2d_items.status was updated
--   rejected    — user clicked No; item untouched
--   dismissed   — user clicked Dismiss; surfaces in cockpit "Pending" for 24h
--   expired     — dismissed beyond 24h OR never decided after 7d
--
-- proposed_state mirrors a subset of s2d_items.status values that the
-- watcher is allowed to propose. We never propose 'backlog' / 'todo' /
-- 'in_queue' — only forward transitions to 'in_progress' or 'done'.

CREATE TABLE IF NOT EXISTS public.activity_suggestions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid(),
  s2d_item_id     UUID NOT NULL REFERENCES public.s2d_items(id) ON DELETE CASCADE,
  proposed_state  TEXT NOT NULL
                    CHECK (proposed_state IN ('in_progress', 'done')),
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'confirmed', 'rejected', 'dismissed', 'expired')),
  confidence      NUMERIC(4,3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  signal_kind     TEXT NOT NULL
                    CHECK (signal_kind IN ('exact_id', 'url_match', 'title_embed', 'cloud_lifecycle')),
  context         JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at      TIMESTAMPTZ,
  dismiss_until   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS activity_suggestions_user_pending_idx
  ON public.activity_suggestions (user_id, created_at DESC)
  WHERE status IN ('pending', 'dismissed');

-- Dedup index for the matcher: don't suggest the same (item, state) twice
-- inside the same 30-min window. The matcher enforces this in code; the
-- index is for the lookup.
CREATE INDEX IF NOT EXISTS activity_suggestions_dedup_idx
  ON public.activity_suggestions (user_id, s2d_item_id, proposed_state, created_at DESC);

ALTER TABLE public.activity_suggestions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own activity_suggestions" ON public.activity_suggestions;
CREATE POLICY "own activity_suggestions" ON public.activity_suggestions
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- =========================================================================
-- activity_settings — per-user opt-in + pause + ignore lists
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.activity_settings (
  user_id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid(),
  enabled          BOOLEAN NOT NULL DEFAULT false,
  paused_until     TIMESTAMPTZ,
  ignore_apps      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ignore_domains   TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.activity_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own activity_settings" ON public.activity_settings;
CREATE POLICY "own activity_settings" ON public.activity_settings
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
