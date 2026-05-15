-- Multi-tenant RLS migration.
--
-- Background: 001_initial_schema.sql enabled RLS on every data table but
-- the policies are `auth.role() = 'authenticated'` — i.e. ANY logged-in
-- user sees everyone's rows. Fine when Sidd was the only user. Not fine
-- as we onboard other product leads, who must not see each other's
-- Gmail/Slack/Linear/board data.
--
-- This migration:
--   1. Adds user_id to every data table that lacks one
--   2. Backfills existing rows to the first user in auth.users (Sidd) so
--      his pre-multi-tenant data isn't orphaned
--   3. Sets NOT NULL + default auth.uid() so future INSERTs auto-attach
--      to the calling user without code changes
--   4. Drops the permissive "any authed" policies and replaces with
--      owner-only `auth.uid() = user_id`
--
-- IMPORTANT — read before applying:
--
-- A. This is destructive in the sense that it changes visibility rules.
--    AFTER applying, code paths using createSupabaseServiceClient that
--    insert rows MUST set user_id explicitly — the column default of
--    auth.uid() only fires when a user-scoped JWT is present, and the
--    service-role key has none. Service-role inserts that omit user_id
--    will fail the NOT NULL.
--
-- B. The backfill assumes Sidd is the user who owns all existing rows.
--    If multiple humans have ever logged in to this DB, run the SELECT
--    in the backfill block manually first to verify the right id is
--    picked.

-- ============================================================================
-- 0. Pre-flight
-- ============================================================================
--
-- We don't stash the primordial user via set_config() — that's transaction-
-- local, which silently breaks if a runner (docker exec psql, etc.) auto-
-- commits each statement. Instead, every UPDATE re-queries auth.users
-- inline.
--
-- The migration works on both:
--   - An existing DB with data (rows get backfilled to the oldest user)
--   - A fresh DB with no users or data (UPDATEs no-op, structure still installs)
--
-- We warn loudly if there's data without a user to attribute it to, but
-- don't crash — that case can only happen when applying to a partially-
-- populated DB, which is exotic.

DO $$
DECLARE
  orphan_count INT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users) THEN
    -- Fresh DB. Nothing to backfill. Structure installs cleanly.
    RAISE NOTICE 'No users in auth.users — skipping backfill (no rows to attribute).';
    RETURN;
  END IF;

  -- Sanity: count rows in s2d_items that would need attribution. Just a
  -- heads-up in the migration log; doesn't gate.
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 's2d_items' AND column_name = 'user_id') THEN
    EXECUTE 'SELECT COUNT(*) FROM s2d_items WHERE user_id IS NULL' INTO orphan_count;
    IF orphan_count > 0 THEN
      RAISE NOTICE 'Will backfill % rows in s2d_items to oldest auth user', orphan_count;
    END IF;
  END IF;
END $$;

-- ============================================================================
-- 1. Per-table: add user_id, backfill, NOT NULL, owner policy
-- ============================================================================
--
-- Pattern repeated per table:
--   ALTER TABLE x ADD COLUMN IF NOT EXISTS user_id UUID
--     REFERENCES auth.users(id) ON DELETE CASCADE;
--   UPDATE x SET user_id = (SELECT id FROM auth.users ORDER BY created_at ASC LIMIT 1)
--     WHERE user_id IS NULL;
--   ALTER TABLE x ALTER COLUMN user_id SET NOT NULL;
--   ALTER TABLE x ALTER COLUMN user_id SET DEFAULT auth.uid();
--   DROP POLICY IF EXISTS "authed full access" ON x;
--   CREATE POLICY "own rows" ON x
--     FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
--
-- We do this for every data table from 001_initial_schema.sql.

-- companies
ALTER TABLE companies ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
UPDATE companies SET user_id = (SELECT id FROM auth.users ORDER BY created_at ASC LIMIT 1) WHERE user_id IS NULL;
ALTER TABLE companies ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE companies ALTER COLUMN user_id SET DEFAULT auth.uid();
DROP POLICY IF EXISTS "authed full access" ON companies;
CREATE POLICY "own rows" ON companies FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_companies_user ON companies(user_id);

-- s2d_items
ALTER TABLE s2d_items ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
UPDATE s2d_items SET user_id = (SELECT id FROM auth.users ORDER BY created_at ASC LIMIT 1) WHERE user_id IS NULL;
ALTER TABLE s2d_items ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE s2d_items ALTER COLUMN user_id SET DEFAULT auth.uid();
DROP POLICY IF EXISTS "authed full access" ON s2d_items;
CREATE POLICY "own rows" ON s2d_items FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_s2d_items_user ON s2d_items(user_id);

-- meetings
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
UPDATE meetings SET user_id = (SELECT id FROM auth.users ORDER BY created_at ASC LIMIT 1) WHERE user_id IS NULL;
ALTER TABLE meetings ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE meetings ALTER COLUMN user_id SET DEFAULT auth.uid();
DROP POLICY IF EXISTS "authed full access" ON meetings;
CREATE POLICY "own rows" ON meetings FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_meetings_user ON meetings(user_id);

-- action_items
ALTER TABLE action_items ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
UPDATE action_items SET user_id = (SELECT id FROM auth.users ORDER BY created_at ASC LIMIT 1) WHERE user_id IS NULL;
ALTER TABLE action_items ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE action_items ALTER COLUMN user_id SET DEFAULT auth.uid();
DROP POLICY IF EXISTS "authed full access" ON action_items;
CREATE POLICY "own rows" ON action_items FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_action_items_user ON action_items(user_id);

-- messages
ALTER TABLE messages ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
UPDATE messages SET user_id = (SELECT id FROM auth.users ORDER BY created_at ASC LIMIT 1) WHERE user_id IS NULL;
ALTER TABLE messages ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE messages ALTER COLUMN user_id SET DEFAULT auth.uid();
DROP POLICY IF EXISTS "authed full access" ON messages;
CREATE POLICY "own rows" ON messages FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id);

-- drafts
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
UPDATE drafts SET user_id = (SELECT id FROM auth.users ORDER BY created_at ASC LIMIT 1) WHERE user_id IS NULL;
ALTER TABLE drafts ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE drafts ALTER COLUMN user_id SET DEFAULT auth.uid();
DROP POLICY IF EXISTS "authed full access" ON drafts;
CREATE POLICY "own rows" ON drafts FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_drafts_user ON drafts(user_id);

-- calendar_events
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
UPDATE calendar_events SET user_id = (SELECT id FROM auth.users ORDER BY created_at ASC LIMIT 1) WHERE user_id IS NULL;
ALTER TABLE calendar_events ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE calendar_events ALTER COLUMN user_id SET DEFAULT auth.uid();
DROP POLICY IF EXISTS "authed full access" ON calendar_events;
CREATE POLICY "own rows" ON calendar_events FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_calendar_events_user ON calendar_events(user_id);

-- linear_orgs
ALTER TABLE linear_orgs ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
UPDATE linear_orgs SET user_id = (SELECT id FROM auth.users ORDER BY created_at ASC LIMIT 1) WHERE user_id IS NULL;
ALTER TABLE linear_orgs ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE linear_orgs ALTER COLUMN user_id SET DEFAULT auth.uid();
DROP POLICY IF EXISTS "authed full access" ON linear_orgs;
CREATE POLICY "own rows" ON linear_orgs FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_linear_orgs_user ON linear_orgs(user_id);

-- linear_issues
ALTER TABLE linear_issues ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
UPDATE linear_issues SET user_id = (SELECT id FROM auth.users ORDER BY created_at ASC LIMIT 1) WHERE user_id IS NULL;
ALTER TABLE linear_issues ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE linear_issues ALTER COLUMN user_id SET DEFAULT auth.uid();
DROP POLICY IF EXISTS "authed full access" ON linear_issues;
CREATE POLICY "own rows" ON linear_issues FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_linear_issues_user ON linear_issues(user_id);

-- notifications
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
UPDATE notifications SET user_id = (SELECT id FROM auth.users ORDER BY created_at ASC LIMIT 1) WHERE user_id IS NULL;
ALTER TABLE notifications ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE notifications ALTER COLUMN user_id SET DEFAULT auth.uid();
DROP POLICY IF EXISTS "authed full access" ON notifications;
CREATE POLICY "own rows" ON notifications FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);

-- follow_ups
ALTER TABLE follow_ups ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
UPDATE follow_ups SET user_id = (SELECT id FROM auth.users ORDER BY created_at ASC LIMIT 1) WHERE user_id IS NULL;
ALTER TABLE follow_ups ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE follow_ups ALTER COLUMN user_id SET DEFAULT auth.uid();
DROP POLICY IF EXISTS "authed full access" ON follow_ups;
CREATE POLICY "own rows" ON follow_ups FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_follow_ups_user ON follow_ups(user_id);

-- briefings
ALTER TABLE briefings ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
UPDATE briefings SET user_id = (SELECT id FROM auth.users ORDER BY created_at ASC LIMIT 1) WHERE user_id IS NULL;
ALTER TABLE briefings ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE briefings ALTER COLUMN user_id SET DEFAULT auth.uid();
DROP POLICY IF EXISTS "authed full access" ON briefings;
CREATE POLICY "own rows" ON briefings FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_briefings_user ON briefings(user_id);

-- chat_sessions
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
UPDATE chat_sessions SET user_id = (SELECT id FROM auth.users ORDER BY created_at ASC LIMIT 1) WHERE user_id IS NULL;
ALTER TABLE chat_sessions ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE chat_sessions ALTER COLUMN user_id SET DEFAULT auth.uid();
DROP POLICY IF EXISTS "authed full access" ON chat_sessions;
CREATE POLICY "own rows" ON chat_sessions FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_user ON chat_sessions(user_id);

-- chat_messages
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
UPDATE chat_messages SET user_id = (SELECT id FROM auth.users ORDER BY created_at ASC LIMIT 1) WHERE user_id IS NULL;
ALTER TABLE chat_messages ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE chat_messages ALTER COLUMN user_id SET DEFAULT auth.uid();
DROP POLICY IF EXISTS "authed full access" ON chat_messages;
CREATE POLICY "own rows" ON chat_messages FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_user ON chat_messages(user_id);

-- memories
ALTER TABLE memories ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
UPDATE memories SET user_id = (SELECT id FROM auth.users ORDER BY created_at ASC LIMIT 1) WHERE user_id IS NULL;
ALTER TABLE memories ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE memories ALTER COLUMN user_id SET DEFAULT auth.uid();
DROP POLICY IF EXISTS "authed full access" ON memories;
CREATE POLICY "own rows" ON memories FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_memories_user ON memories(user_id);

-- user_profile — special: row IS the user. Match by email or auth_user_id.
-- If a column doesn't exist add one; backfill maps existing rows by email
-- to auth.users.
ALTER TABLE user_profile ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
UPDATE user_profile up
   SET user_id = au.id
  FROM auth.users au
 WHERE up.user_id IS NULL AND au.email = up.email;
-- Anything still null after email match gets attributed to the primordial user
UPDATE user_profile SET user_id = (SELECT id FROM auth.users ORDER BY created_at ASC LIMIT 1) WHERE user_id IS NULL;
ALTER TABLE user_profile ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE user_profile ALTER COLUMN user_id SET DEFAULT auth.uid();
DROP POLICY IF EXISTS "authed full access" ON user_profile;
CREATE POLICY "own row" ON user_profile FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_profile_user ON user_profile(user_id);

-- embeddings
ALTER TABLE embeddings ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
UPDATE embeddings SET user_id = (SELECT id FROM auth.users ORDER BY created_at ASC LIMIT 1) WHERE user_id IS NULL;
ALTER TABLE embeddings ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE embeddings ALTER COLUMN user_id SET DEFAULT auth.uid();
DROP POLICY IF EXISTS "authed full access" ON embeddings;
CREATE POLICY "own rows" ON embeddings FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_embeddings_user ON embeddings(user_id);

-- sprint_sessions
ALTER TABLE sprint_sessions ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
UPDATE sprint_sessions SET user_id = (SELECT id FROM auth.users ORDER BY created_at ASC LIMIT 1) WHERE user_id IS NULL;
ALTER TABLE sprint_sessions ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE sprint_sessions ALTER COLUMN user_id SET DEFAULT auth.uid();
DROP POLICY IF EXISTS "authed full access" ON sprint_sessions;
CREATE POLICY "own rows" ON sprint_sessions FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_sprint_sessions_user ON sprint_sessions(user_id);

-- ai_usage_log — already has user_id from 005, but the policy is too loose.
-- Tracker writes via service-role (no JWT) so we leave INSERT open and only
-- tighten SELECT to own rows. user_id stays nullable for legacy service-role
-- writes; refactor trackedCreate to thread userId later.
DROP POLICY IF EXISTS "authed full access" ON ai_usage_log;
CREATE POLICY "own usage select" ON ai_usage_log
  FOR SELECT USING (auth.uid() = user_id OR user_id IS NULL);
CREATE POLICY "any insert" ON ai_usage_log
  FOR INSERT WITH CHECK (true);

-- ============================================================================
-- 2. Onboarding state on user_profile
-- ============================================================================
--
-- onboarding_step: which step of the wizard the user is on (1..6, 0 = not started, NULL = legacy)
-- onboarded_at:    timestamp when they finished step 6
-- onboarding_cleanup_ran_at: when the moderate-aggressive cleanup pass ran
--                            (gates the one-time job so it can't re-fire)

ALTER TABLE user_profile
  ADD COLUMN IF NOT EXISTS onboarding_step SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS onboarded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS onboarding_cleanup_ran_at TIMESTAMPTZ;

-- Treat existing primordial user as already-onboarded so they skip the wizard
UPDATE user_profile
   SET onboarding_step = 6,
       onboarded_at = COALESCE(onboarded_at, now()),
       onboarding_cleanup_ran_at = COALESCE(onboarding_cleanup_ran_at, now())
 WHERE user_id = (SELECT id FROM auth.users ORDER BY created_at ASC LIMIT 1);

-- ============================================================================
-- 3. Domain allowlist for signup
-- ============================================================================
--
-- A trigger on auth.users rejects new sign-ups whose email domain isn't on
-- the allowlist. Edit `signup_allowlist` to control who can register.
--
-- Storing as a table rather than a hardcoded check so it can be edited via
-- SQL without redeploying. Wire to an admin UI later.

CREATE TABLE IF NOT EXISTS signup_allowlist (
  domain TEXT PRIMARY KEY,
  note TEXT,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed with Beacon's domain. Add others via:
--   INSERT INTO signup_allowlist (domain, note) VALUES ('example.com', 'Why');
INSERT INTO signup_allowlist (domain, note)
VALUES ('beaconsoftware.com', 'Beacon Software product leads')
ON CONFLICT (domain) DO NOTHING;

CREATE OR REPLACE FUNCTION enforce_signup_allowlist()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  email_domain TEXT;
BEGIN
  email_domain := split_part(NEW.email, '@', 2);
  IF NOT EXISTS (SELECT 1 FROM signup_allowlist WHERE domain = email_domain) THEN
    RAISE EXCEPTION 'Email domain "%" is not on the signup allowlist. Contact an admin.', email_domain;
  END IF;
  RETURN NEW;
END;
$$;

-- Fire on INSERT to auth.users (Supabase Auth runs this when sign-up succeeds).
DROP TRIGGER IF EXISTS enforce_signup_allowlist_trigger ON auth.users;
CREATE TRIGGER enforce_signup_allowlist_trigger
  BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION enforce_signup_allowlist();

-- ============================================================================
-- 4. Auto-create user_profile row on signup
-- ============================================================================
--
-- Without this, new users have no user_profile row, and the dashboard layout
-- query `select communication_style from user_profile` returns nothing. Make
-- profile creation atomic with auth.

CREATE OR REPLACE FUNCTION create_user_profile_on_signup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO user_profile (user_id, email, name, onboarding_step)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)), 0)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS create_user_profile_trigger ON auth.users;
CREATE TRIGGER create_user_profile_trigger
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION create_user_profile_on_signup();
