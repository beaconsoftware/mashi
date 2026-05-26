-- 030_watch_check_ins.sql
--
-- Sprint Focus redesign — Phase 3 (Heads-down + Watching + Delegate).
--
-- The WatchCanvas surfaces a "Still watching" affordance: rather than
-- closing the slot terminally, the user logs that they've checked in,
-- captures any signals seen since the last check, and the item stays
-- in_queue while the next sprint slot promotes. Each check-in becomes
-- a row in watch_check_ins so the sprint-complete recap (and any later
-- "watching trail" view) can show the chain of check-ins per item in
-- chronological order.
--
-- A check-in row with `continued = false` represents the terminal
-- "Stop watching" exit — the same UI affordance that abandons the
-- watch records why and when it ended.
--
-- Additive + idempotent per AGENTS.md migration discipline. RLS owner-
-- only, mirroring every other tenant-scoped table.

CREATE TABLE IF NOT EXISTS public.watch_check_ins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT auth.uid()
    REFERENCES auth.users(id) ON DELETE CASCADE,
  s2d_item_id UUID NOT NULL
    REFERENCES public.s2d_items(id) ON DELETE CASCADE,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  note TEXT NULL,
  signals_since_last JSONB NULL,
  continued BOOLEAN NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_watch_check_ins_item
  ON public.watch_check_ins(s2d_item_id, at DESC);

ALTER TABLE public.watch_check_ins ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'watch_check_ins'
      AND policyname = 'watch_check_ins_owner'
  ) THEN
    CREATE POLICY watch_check_ins_owner ON public.watch_check_ins
      FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

COMMENT ON TABLE public.watch_check_ins IS
  'Per-check-in trail for `watching` s2d_items. Written by the sprint Watch canvas''s Still-watching / Stop-watching exits.';

COMMENT ON COLUMN public.watch_check_ins.continued IS
  'true = Still watching (item stays in_queue, slot promotes next). false = Stop watching (item closes terminally; the canvas also marks the s2d_item done with resolved_via = ''abandoned'').';

COMMENT ON COLUMN public.watch_check_ins.signals_since_last IS
  'Optional JSONB snapshot of activity signals the canvas surfaced at check-in time. Shape: { signals: [{ kind, label, at, snippet? }] }.';
