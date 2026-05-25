-- 027_enriched_context.sql
--
-- Adds per-item enriched_context for the Sprint Card v2 redesign.
--
-- Sprint cards get a new "Enrich + Plan" section: an explicit "Run
-- Enrich" button triggers a pathway-routed agent that searches the
-- user's data (s2d_items, gmail, slack, linear, fireflies, github, …)
-- and returns:
--   1. A 3-step PLAN for tackling the item.
--   2. A set of PULLED SOURCES (citations) the user can pin/unpin so
--      downstream agents (Draft, Claude handoff) get the right context.
--   3. A REFINE thread — the user can ask follow-up questions in
--      natural language ("find me examples from May") and the agent
--      runs additional searches against the same item's context.
--
-- All of this persists on the item itself so the work survives card
-- close, sprint exit, and reload. Resetting per-sprint felt wasteful;
-- the user's refinements are real intellectual work.
--
-- Shape (validated app-side; DB doesn't enforce JSON schema):
--   {
--     "plan": [ "string", ... ],
--     "pulled_sources": [
--       {
--         "kind": "s2d" | "gmail" | "slack" | "linear" | "fireflies" | "github" | "meeting",
--         "ref":  "<provider-id-or-url>",
--         "label": "string",
--         "snippet": "string",
--         "when": "iso8601" | null,
--         "pinned": boolean
--       },
--       ...
--     ],
--     "thread": [
--       { "role": "user" | "assistant", "content": "string",
--         "citations": [...] | null,  -- optional, for assistant turns
--         "at": "iso8601" }
--     ],
--     "last_enriched_at": "iso8601"
--   }
--
-- A second column captures the timestamp explicitly so we can index/
-- filter on freshness without parsing the jsonb.
--
-- Additive + idempotent per AGENTS.md migration discipline.

ALTER TABLE public.s2d_items
  ADD COLUMN IF NOT EXISTS enriched_context JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.s2d_items
  ADD COLUMN IF NOT EXISTS enriched_at TIMESTAMPTZ;

COMMENT ON COLUMN public.s2d_items.enriched_context IS
  'Sprint-card Enrich+Plan output: { plan, pulled_sources, thread, last_enriched_at }. Persists across card opens. Updated by POST /api/s2d/{id}/enrich.';

COMMENT ON COLUMN public.s2d_items.enriched_at IS
  'Timestamp of the most recent enrich run for this item. NULL when never enriched. Cheaper to filter on than parsing enriched_context.last_enriched_at.';

-- Index for "items enriched in the last N days" / "items never enriched"
-- queries. Partial index — most items will never be enriched so the
-- full-table index would be wasteful.
CREATE INDEX IF NOT EXISTS s2d_items_enriched_at_idx
  ON public.s2d_items (user_id, enriched_at DESC)
  WHERE enriched_at IS NOT NULL;
