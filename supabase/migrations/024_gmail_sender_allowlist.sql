-- 024_gmail_sender_allowlist.sql
--
-- Gmail sender allowlist for the category:updates tab.
--
-- Gmail's auto-categorization occasionally buckets transactional emails
-- (Ramp's "Submit missing items", Stripe receipts, etc.) into the
-- Updates tab. The default sync query explicitly excludes Updates to
-- cut newsletter / digest noise, so those notifications go missing.
--
-- This column holds the MANUAL list: exact email-address matches the
-- user explicitly added via Settings → Connections → Gmail. The sync
-- worker runs a second list query
--
--   in:inbox category:updates newer_than:Nd (from:a OR from:b OR ...)
--
-- and merges the results with the Primary query, deduped by message id.
--
-- The AUTO list (addresses the user has sent to in the last 90 days)
-- lives alongside it in the existing raw_provider_data JSONB blob,
-- keyed under "gmail_auto_allowlist" — refreshed every 24 hours during
-- normal sync runs. No schema change needed for that side.
--
-- Idempotent: re-applying is a no-op via IF NOT EXISTS.

ALTER TABLE public.connected_accounts
  ADD COLUMN IF NOT EXISTS gmail_sender_allowlist TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

COMMENT ON COLUMN public.connected_accounts.gmail_sender_allowlist IS
  'Gmail provider only: exact email addresses (lowercase) the user has opted in to syncing from the category:updates tab. Empty = default behaviour (Updates tab excluded entirely). Auto-populated companion list lives at raw_provider_data.gmail_auto_allowlist.';
