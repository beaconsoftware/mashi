-- 045_agent_approval_context.sql
--
-- P4.a (Epic E2) — carry an optional before-snapshot on a pending ring-3
-- approval so the inline approval card can render a before/after diff for
-- update-type calls (update_calendar_event, update_linear_issue, ...).
--
-- Additive + idempotent per the migration discipline in AGENTS.md:
--   - ADD COLUMN IF NOT EXISTS (re-runnable; a no-op once applied)
--   - NULL for every existing + non-update row (the card just shows the
--     proposed args with no diff, exactly as before)
--
-- The column is owner-scoped transitively: agent_approvals already carries
-- user_id + owner-only RLS (034_agent_approvals.sql); `context` is just
-- additional JSONB on the same row, so no new policy is required.

ALTER TABLE public.agent_approvals
  ADD COLUMN IF NOT EXISTS context JSONB NULL;

COMMENT ON COLUMN public.agent_approvals.context IS
  'P4.a/E2: optional approval context (e.g. { before: {...} } before-snapshot) used by the in-chat approval card to diff an update against current values. Populated by a tool''s approvalContext(); NULL when the tool supplies none.';

-- Make the new column queryable immediately on deploy.
NOTIFY pgrst, 'reload schema';
