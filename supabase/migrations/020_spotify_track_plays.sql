-- 020_spotify_track_plays.sql
--
-- Logs Spotify tracks heard during active sprint slots, tagged by the
-- s2d item that was active when the track was sampled. Drives future
-- "what songs make me productive on what kind of work" insights and
-- playlist auto-generation.
--
-- Sampling cadence is the API poller's responsibility (default ~10s);
-- a single track-listen produces one row per `(s2d_item_id, track_id)`
-- pair per sprint session via an upsert, with ms_during_active
-- accumulating each time the same (item, track) pair re-samples.
--
-- Multi-tenancy invariants per AGENTS.md:
--   - user_id NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id)
--   - RLS enabled, owner-only USING + WITH CHECK
--   - Service-role writes (e.g. background analytics rollups later)
--     must set user_id explicitly.
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS public.spotify_track_plays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Optional linkage to a sprint session row. Nullable because the
  -- session row is created at sprint *complete*, not start — so during
  -- the active window we don't yet have the session id. The poller
  -- writes with null and a backfill step on sprint complete fills it.
  sprint_session_id UUID REFERENCES public.sprint_sessions(id) ON DELETE SET NULL,

  -- Which slot item was active when this track played. Required —
  -- otherwise the row is useless for task-vs-music correlation.
  s2d_item_id UUID NOT NULL REFERENCES public.s2d_items(id) ON DELETE CASCADE,

  -- Spotify track identity (URI / ID is stable across regions).
  track_id TEXT NOT NULL,
  track_uri TEXT,
  track_name TEXT,
  artist_id TEXT,
  artist_name TEXT,
  album_name TEXT,
  album_image_url TEXT,
  duration_ms INT,

  -- First time we observed this track during this (item, session)
  -- window, plus accumulated ms it was the currently-playing track
  -- while the slot was active. Both can update as the poller resamples.
  first_observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ms_during_active INT NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per (user, sprint, item, track) so the poller can upsert
-- safely without producing a stream of duplicate samples.
CREATE UNIQUE INDEX IF NOT EXISTS spotify_track_plays_dedupe_idx
  ON public.spotify_track_plays (user_id, sprint_session_id, s2d_item_id, track_id);

CREATE INDEX IF NOT EXISTS spotify_track_plays_user_observed_idx
  ON public.spotify_track_plays (user_id, last_observed_at DESC);

CREATE INDEX IF NOT EXISTS spotify_track_plays_item_idx
  ON public.spotify_track_plays (s2d_item_id);

-- RLS owner-only.
ALTER TABLE public.spotify_track_plays ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "spotify_track_plays owner-only select" ON public.spotify_track_plays;
CREATE POLICY "spotify_track_plays owner-only select"
  ON public.spotify_track_plays FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "spotify_track_plays owner-only insert" ON public.spotify_track_plays;
CREATE POLICY "spotify_track_plays owner-only insert"
  ON public.spotify_track_plays FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "spotify_track_plays owner-only update" ON public.spotify_track_plays;
CREATE POLICY "spotify_track_plays owner-only update"
  ON public.spotify_track_plays FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "spotify_track_plays owner-only delete" ON public.spotify_track_plays;
CREATE POLICY "spotify_track_plays owner-only delete"
  ON public.spotify_track_plays FOR DELETE
  USING (auth.uid() = user_id);

-- Per-user opt-out preference. Default true (logging on) so the feature
-- works out of the box, but the user can flip it from Settings.
ALTER TABLE public.user_profile
  ADD COLUMN IF NOT EXISTS spotify_logging_enabled BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.user_profile.spotify_logging_enabled IS
  'When false, the Spotify poller skips writing rows to spotify_track_plays. UI controls remain functional.';
