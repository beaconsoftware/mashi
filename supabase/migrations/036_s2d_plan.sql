-- 036_s2d_plan.sql
--
-- Phase 8 of the agent buildout: Focus card needs a user-owned plan
-- checklist on every s2d item. Editable by the user in the Plan tab; the
-- agent can append or replace via the `set_plan` ring-2 tool, with the
-- prior value captured as `undo_payload` so the 30s undo strip can
-- restore it.

ALTER TABLE public.s2d_items
  ADD COLUMN IF NOT EXISTS plan JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.s2d_items.plan IS
  'User-owned checklist for working on this item: [{ id, text, checked, created_at }]. Editable in the Focus card Plan tab. The agent can append or replace via the set_plan ring-2 tool, with the prior value captured as undo_payload.';
