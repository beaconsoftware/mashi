-- ============================================================
-- 006 — needs_reauth status
--
-- When a provider's OAuth token expires or gets revoked and we don't have
-- a refresh path, the right state isn't generic "error" — it's specifically
-- "this connection needs the user to re-authorize." We surface this in the
-- UI as a Reconnect button instead of a silent error banner.
-- ============================================================

ALTER TABLE connected_accounts
  DROP CONSTRAINT IF EXISTS connected_accounts_last_sync_status_check;

ALTER TABLE connected_accounts
  ADD CONSTRAINT connected_accounts_last_sync_status_check
  CHECK (last_sync_status IN ('idle', 'syncing', 'success', 'error', 'needs_reauth'));
