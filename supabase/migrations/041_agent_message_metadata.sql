-- 041_agent_message_metadata.sql
--
-- Mashi Agent buildout — P1 (foundation hardening: A8 / A9).
--
-- The interactive loop now needs to record non-content state about an
-- assistant message:
--
--   - A8 (preserve partial text on error/abort): on a mid-stream throw or
--     a client abort we persist whatever assistant text already streamed
--     instead of replacing it with a "[stream error] ..." marker. The
--     error / cancellation is recorded as an annotation, not by clobbering
--     the user-visible text.
--   - A9 (adaptive max_tokens + truncation detection): when a draft stops
--     on stop_reason="max_tokens" we flag the message truncated so the UI
--     can warn and the message is never treated as a finished answer.
--   - A6 (per-turn budget): a turn that halts at its token budget records
--     why on its terminal message.
--
-- One additive JSONB column carries all of these as optional keys, so
-- future flags don't need another migration. Shape (all keys optional):
--   {
--     "error":           "<message>",   -- A8: stream failed, text preserved
--     "retryable":       true,           -- A8/A4: transient, a Retry helps
--     "cancelled":       true,           -- A3: user/abort stopped the turn
--     "truncated":       true,           -- A9: stop_reason was max_tokens
--     "budget_exhausted": true           -- A6: turn hit its token budget
--   }
--
-- Additive + idempotent per AGENTS.md migration discipline. NULL for every
-- pre-existing row and for every healthy message; the loop only stamps it
-- on the exceptional paths.

ALTER TABLE public.agent_messages
  ADD COLUMN IF NOT EXISTS metadata JSONB NULL;

COMMENT ON COLUMN public.agent_messages.metadata IS
  'Optional per-message annotations for the exceptional loop paths (P1): error+retryable (A8/A4 stream failure with partial text preserved), cancelled (A3 abort), truncated (A9 max_tokens), budget_exhausted (A6). NULL for healthy messages.';
