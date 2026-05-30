-- 044_agent_references.sql
--
-- Mashi Agent buildout — P3 / B2 (@-mentions in the composer).
--
-- One additive change: `agent_messages.pinned_references` — a JSONB array
-- of reference descriptors the user pinned via the composer's @-typeahead,
-- persisted on the user message row. Shape (each element):
--   { "kind": "item", "id": "<s2d_items.id>", "label": "Approve Q4 brand spend",
--     "ticketNumber": 1408 }
-- The loop re-validates each id against the user's own s2d_items (canonical
-- label + ticket, dropping forged / foreign / stale ids) before persisting,
-- then `messagesToReplay` prepends a short "pinned references" note to the
-- user message so the model skips the resolve_reference round-trip. NULL for
-- every message without pinned references.
--
-- Column is named `pinned_references` (not `references`) because REFERENCES
-- is a reserved SQL keyword that would need quoting everywhere.
--
-- Additive + idempotent per AGENTS.md migration discipline: ADD COLUMN IF
-- NOT EXISTS, so re-running is a no-op.

ALTER TABLE public.agent_messages
  ADD COLUMN IF NOT EXISTS pinned_references JSONB NULL;

COMMENT ON COLUMN public.agent_messages.pinned_references IS
  'B2 (P3): JSONB array of @-mention reference descriptors on the user message row {kind, id, label, ticketNumber}. Re-validated against the user''s s2d_items server-side before persist. NULL when the message has no pinned references.';
