-- 019_slack_channel_monitoring.sql
--
-- Opt-in monitoring for Slack public + private channels. DMs and group
-- DMs are still always monitored automatically (the user "owns" those
-- conversations entirely). For channels — where most workspaces have
-- 100s of them and the user is only actively involved in a handful —
-- the user picks which to include via the connections UI.
--
-- Storage shape: array of channel IDs (strings). Per-channel sync state
-- (first_synced_at, used for the 7-day bootstrap on newly-added
-- channels) lives in the existing raw_provider_data JSONB blob, keyed
-- under "slack_channel_first_synced" — that way we don't proliferate
-- columns for one provider's bookkeeping.
--
-- Idempotent: re-applying is a no-op via IF NOT EXISTS.

ALTER TABLE public.connected_accounts
  ADD COLUMN IF NOT EXISTS slack_monitored_channels JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.connected_accounts.slack_monitored_channels IS
  'Slack provider only: array of channel IDs the user has opted into for sync. DMs and mpim are always synced regardless of this list. Public/private channels appear in sync only when their id is in this array.';
