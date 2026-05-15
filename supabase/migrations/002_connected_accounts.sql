-- ============================================================
-- 002 — Connected accounts (multi-org OAuth integrations)
--
-- One row per connection. Sidd can connect:
--   - multiple Gmail accounts (Beacon + each portco inbox he has access to)
--   - multiple Slack workspaces
--   - multiple Linear orgs
--   - multiple Fireflies / Outlook / etc.
--
-- The existing linear_orgs table is superseded by this. We keep it
-- (no data yet) but new code should target connected_accounts.
-- ============================================================

CREATE TABLE connected_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  provider TEXT NOT NULL CHECK (provider IN (
    'google',      -- sign-in identity (Supabase manages tokens; we keep a row for UI display)
    'gmail',       -- Gmail content scopes (read / send / etc)
    'gcal',        -- Google Calendar
    'microsoft',   -- Microsoft identity (sign-in or basic)
    'outlook',     -- Outlook mail
    'mscal',       -- Microsoft Calendar
    'slack',
    'linear',
    'fireflies',
    'granola',
    'notion'
  )),

  -- Provider's identifier for this account / org / workspace
  external_id TEXT,

  -- Display fields for the Connections UI
  account_email TEXT,
  account_label TEXT,
  account_avatar_url TEXT,

  -- Optional: pin this connection to a portfolio company
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,

  -- OAuth credentials — ALWAYS encrypted at the application layer (AES-256-GCM)
  access_token_encrypted TEXT,
  refresh_token_encrypted TEXT,
  token_type TEXT,
  scopes TEXT[] DEFAULT '{}',
  expires_at TIMESTAMPTZ,

  -- True if this is the identity used to sign in to Mashi (e.g. the user's primary Google)
  is_signin BOOLEAN DEFAULT false,

  -- Sync metadata
  last_synced_at TIMESTAMPTZ,
  last_sync_status TEXT DEFAULT 'idle'
    CHECK (last_sync_status IN ('idle', 'syncing', 'success', 'error')),
  last_sync_error TEXT,

  -- Provider-specific blob
  raw_provider_data JSONB DEFAULT '{}',

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Same user can't connect the same provider+external_id twice
  UNIQUE (user_id, provider, external_id)
);

CREATE INDEX connected_accounts_user_provider_idx
  ON connected_accounts(user_id, provider);

CREATE TRIGGER set_connected_accounts_updated_at BEFORE UPDATE ON connected_accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE connected_accounts ENABLE ROW LEVEL SECURITY;

-- Owner-only access. Stricter than the spec's "any authenticated user" so
-- one user's tokens can never be leaked to another user even server-side.
CREATE POLICY "own connected accounts" ON connected_accounts
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- OAuth flow state — short-lived PKCE / state tokens
-- ============================================================
CREATE TABLE oauth_flow_states (
  state TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  code_verifier TEXT,
  redirect_after TEXT,
  extra JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '10 minutes')
);

CREATE INDEX oauth_flow_states_expires_idx ON oauth_flow_states(expires_at);

ALTER TABLE oauth_flow_states ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own oauth flow state" ON oauth_flow_states
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- Add connected_account_id FK to source-bearing tables
-- ============================================================
ALTER TABLE messages
  ADD COLUMN connected_account_id UUID REFERENCES connected_accounts(id) ON DELETE SET NULL;
CREATE INDEX messages_connected_idx ON messages(connected_account_id);

ALTER TABLE meetings
  ADD COLUMN connected_account_id UUID REFERENCES connected_accounts(id) ON DELETE SET NULL;
CREATE INDEX meetings_connected_idx ON meetings(connected_account_id);

ALTER TABLE linear_issues
  ADD COLUMN connected_account_id UUID REFERENCES connected_accounts(id) ON DELETE SET NULL;
CREATE INDEX linear_issues_connected_idx ON linear_issues(connected_account_id);

ALTER TABLE calendar_events
  ADD COLUMN connected_account_id UUID REFERENCES connected_accounts(id) ON DELETE SET NULL;
CREATE INDEX calendar_events_connected_idx ON calendar_events(connected_account_id);

-- ============================================================
-- Realtime
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE connected_accounts;
