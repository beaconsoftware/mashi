-- 029_decision_log.sql
--
-- Sprint Focus redesign — Phase 2 (Reply + Decide canvases).
--
-- The DecideCanvas writes a full structured decision_log JSONB on the
-- s2d_item itself: the choice (yes / yes-but / no / defer), free-form
-- note, optional condition (Yes-but) or defer date, sources cited at
-- decision time, and the spawned follow-up item id when Yes-but
-- branches into a new s2d_item.
--
-- We also add two columns that the post-reply "watching" follow-up
-- (ReplyCanvas Send) and Yes-but follow-up both use to record provenance:
--   - spawned_from_item_id: which item produced this one
--   - spawn_reason:         short tag describing the spawn flow
--                           (e.g. "post-reply-watch", "decision-yes-but")
--
-- Note: decision_note / decision_at from 028 stay as-is — the new
-- decision_log JSONB is a richer superset (note + structured fields)
-- and the canvases write both for backward compatibility with anything
-- that already reads decision_note.
--
-- Additive + idempotent per AGENTS.md migration discipline.

ALTER TABLE public.s2d_items
  ADD COLUMN IF NOT EXISTS decision_log JSONB NULL;

ALTER TABLE public.s2d_items
  ADD COLUMN IF NOT EXISTS spawned_from_item_id UUID NULL
    REFERENCES public.s2d_items(id) ON DELETE SET NULL;

ALTER TABLE public.s2d_items
  ADD COLUMN IF NOT EXISTS spawn_reason TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_s2d_items_spawned_from
  ON public.s2d_items(spawned_from_item_id)
  WHERE spawned_from_item_id IS NOT NULL;

COMMENT ON COLUMN public.s2d_items.decision_log IS
  'For decision_gate items: { choice, note, condition?, deferUntil?, followUpItemId?, sourcesCited, decidedAt }. Written by the Decide canvas in sprint focus mode.';

COMMENT ON COLUMN public.s2d_items.spawned_from_item_id IS
  'When this item was created by a sprint slot exit (Send → watch follow-up, Yes-but follow-up, etc.), points back to the originating item.';

COMMENT ON COLUMN public.s2d_items.spawn_reason IS
  'Short machine-readable tag for the spawn flow: "post-reply-watch", "decision-yes-but", etc.';
