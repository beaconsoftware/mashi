-- ============================================================
-- Mashi — Personal AI Chief of Staff
-- Initial schema migration (spec §6)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================
-- COMPANIES
-- ============================================================
CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  color_hex TEXT DEFAULT '#6B7280',
  linear_org_id TEXT,
  slack_workspace_id TEXT,
  email_domain TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'exited', 'prospect')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- S2D ITEMS (core feature)
-- ============================================================
CREATE TABLE s2d_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  title TEXT NOT NULL,
  description TEXT,

  status TEXT NOT NULL DEFAULT 'backlog'
    CHECK (status IN ('backlog', 'todo', 'in_progress', 'in_queue', 'done')),

  pathway TEXT NOT NULL DEFAULT 'heads_down'
    CHECK (pathway IN (
      'quick_reply', 'drafted_response', 'meeting_backed',
      'heads_down', 'decision_gate', 'delegated', 'watching'
    )),

  priority TEXT DEFAULT 'medium' CHECK (priority IN ('urgent', 'high', 'medium', 'low')),
  est_minutes INT,
  energy TEXT DEFAULT 'medium' CHECK (energy IN ('low', 'medium', 'high')),

  source_type TEXT CHECK (source_type IN ('linear', 'gmail', 'slack', 'fireflies', 'granola', 'calendar', 'manual')),
  source_id TEXT,
  source_url TEXT,
  source_label TEXT,

  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,

  ai_suggestion TEXT,
  ai_draft TEXT,
  ai_suggestion_generated_at TIMESTAMPTZ,

  sprint_date DATE,
  sprint_order INT,
  sprint_type TEXT CHECK (sprint_type IN ('morning', 'midday', 'eod', 'power_hour')),

  queue_reason TEXT,
  queue_until TIMESTAMPTZ,

  linked_calendar_event_id TEXT,
  linked_meeting_id UUID,

  delegated_to TEXT,
  delegation_sent_at TIMESTAMPTZ,
  delegation_follow_up_date DATE,

  outcome TEXT,
  resolved_via TEXT,

  snoozed_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  done_at TIMESTAMPTZ
);

CREATE INDEX s2d_status_idx ON s2d_items(status);
CREATE INDEX s2d_priority_idx ON s2d_items(priority);
CREATE INDEX s2d_sprint_idx ON s2d_items(sprint_date);
CREATE INDEX s2d_company_idx ON s2d_items(company_id);

-- ============================================================
-- MEETINGS (Fireflies + Granola)
-- ============================================================
CREATE TABLE meetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  source TEXT NOT NULL CHECK (source IN ('fireflies', 'granola')),
  external_id TEXT UNIQUE,
  title TEXT,
  date TIMESTAMPTZ,
  duration_minutes INT,
  attendees JSONB DEFAULT '[]',
  transcript_raw TEXT,
  summary TEXT,
  action_items_extracted BOOLEAN DEFAULT false,
  raw_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ACTION ITEMS (extracted from meetings)
-- ============================================================
CREATE TABLE action_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_meeting_id UUID REFERENCES meetings(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  s2d_item_id UUID REFERENCES s2d_items(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  assignee TEXT,
  due_date DATE,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'complete', 'cancelled', 'converted_to_s2d')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- MESSAGES (Gmail + Slack unified inbox)
-- ============================================================
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  source TEXT NOT NULL CHECK (source IN ('gmail', 'slack')),
  external_id TEXT UNIQUE,
  thread_id TEXT,
  channel TEXT,
  sender_name TEXT,
  sender_email TEXT,
  subject TEXT,
  preview TEXT,
  full_content TEXT,
  priority_score INT CHECK (priority_score BETWEEN 1 AND 10),
  priority_label TEXT CHECK (priority_label IN ('urgent', 'action_required', 'fyi', 'low_priority', 'noise')),
  s2d_item_id UUID REFERENCES s2d_items(id) ON DELETE SET NULL,
  read BOOLEAN DEFAULT false,
  archived BOOLEAN DEFAULT false,
  received_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX messages_priority_idx ON messages(priority_label, read);
CREATE INDEX messages_source_idx ON messages(source, archived);

-- ============================================================
-- DRAFTS
-- ============================================================
CREATE TABLE drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  s2d_item_id UUID REFERENCES s2d_items(id) ON DELETE CASCADE,
  in_reply_to_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  source TEXT NOT NULL CHECK (source IN ('gmail', 'slack')),
  to_recipients TEXT[],
  subject TEXT,
  content TEXT NOT NULL,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'sent', 'cancelled')),
  iteration_count INT DEFAULT 0,
  approved_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- CALENDAR EVENTS
-- ============================================================
CREATE TABLE calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  source TEXT NOT NULL CHECK (source IN ('google', 'outlook')),
  external_id TEXT UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  attendees JSONB DEFAULT '[]',
  location TEXT,
  meeting_url TEXT,
  prep_brief TEXT,
  prep_brief_generated_at TIMESTAMPTZ,
  linked_s2d_items UUID[],
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX calendar_date_idx ON calendar_events(start_at);

-- ============================================================
-- LINEAR (multi-org)
-- ============================================================
CREATE TABLE linear_orgs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  linear_org_id TEXT UNIQUE NOT NULL,
  org_name TEXT,
  access_token_encrypted TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE linear_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  linear_org_id UUID REFERENCES linear_orgs(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  external_id TEXT UNIQUE,
  title TEXT,
  description TEXT,
  status TEXT,
  priority INT,
  assignee_name TEXT,
  assignee_email TEXT,
  labels TEXT[],
  due_date DATE,
  url TEXT,
  s2d_item_id UUID REFERENCES s2d_items(id) ON DELETE SET NULL,
  last_synced_at TIMESTAMPTZ,
  raw_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- NOTIFICATIONS
-- ============================================================
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  source_type TEXT,
  source_id UUID,
  s2d_item_id UUID REFERENCES s2d_items(id) ON DELETE CASCADE,
  read BOOLEAN DEFAULT false,
  action_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- FOLLOW-UPS
-- ============================================================
CREATE TABLE follow_ups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  s2d_item_id UUID REFERENCES s2d_items(id) ON DELETE SET NULL,
  source TEXT CHECK (source IN ('meeting', 'email', 'slack', 'manual')),
  description TEXT NOT NULL,
  due_date DATE,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'snoozed', 'complete', 'cancelled')),
  snoozed_until DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- DAILY BRIEFINGS
-- ============================================================
CREATE TABLE briefings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE UNIQUE NOT NULL,
  content TEXT NOT NULL,
  s2d_snapshot JSONB,
  generated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- CHAT
-- ============================================================
CREATE TABLE chat_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT,
  context JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  tool_calls JSONB,
  approval_cards JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- MEMORY
-- ============================================================
CREATE TABLE memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content TEXT NOT NULL,
  tags TEXT[],
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- USER PROFILE
-- ============================================================
CREATE TABLE user_profile (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT,
  email TEXT,
  timezone TEXT DEFAULT 'America/Toronto',
  briefing_time TIME DEFAULT '07:30:00',
  briefing_channels TEXT[] DEFAULT ARRAY['app'],
  communication_style JSONB,
  notification_preferences JSONB DEFAULT '{}',
  sprint_preferences JSONB DEFAULT '{
    "morning_start": "08:00",
    "morning_end": "10:00",
    "midday_start": "12:00",
    "midday_end": "13:00",
    "eod_start": "16:00",
    "eod_end": "17:00"
  }',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- VECTOR EMBEDDINGS (semantic search)
-- ============================================================
CREATE TABLE embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('meeting', 'message', 's2d', 'linear_issue', 'note')),
  entity_id UUID NOT NULL,
  chunk_index INT DEFAULT 0,
  chunk_text TEXT NOT NULL,
  embedding vector(1024),
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX embeddings_vec_idx ON embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ============================================================
-- SPRINT SESSIONS
-- ============================================================
CREATE TABLE sprint_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sprint_type TEXT NOT NULL CHECK (sprint_type IN ('morning', 'midday', 'eod', 'power_hour')),
  date DATE NOT NULL,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  planned_items UUID[],
  completed_items UUID[],
  velocity_score FLOAT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- updated_at TRIGGERS
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_companies_updated_at BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_s2d_updated_at BEFORE UPDATE ON s2d_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_linear_issues_updated_at BEFORE UPDATE ON linear_issues
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER set_user_profile_updated_at BEFORE UPDATE ON user_profile
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- RLS POLICIES (single-user app — authenticated user owns all)
-- ============================================================
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE s2d_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE linear_orgs ENABLE ROW LEVEL SECURITY;
ALTER TABLE linear_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE follow_ups ENABLE ROW LEVEL SECURITY;
ALTER TABLE briefings ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE sprint_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authed full access" ON companies        FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "authed full access" ON s2d_items        FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "authed full access" ON meetings         FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "authed full access" ON action_items     FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "authed full access" ON messages         FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "authed full access" ON drafts           FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "authed full access" ON calendar_events  FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "authed full access" ON linear_orgs      FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "authed full access" ON linear_issues    FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "authed full access" ON notifications    FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "authed full access" ON follow_ups       FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "authed full access" ON briefings        FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "authed full access" ON chat_sessions    FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "authed full access" ON chat_messages    FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "authed full access" ON memories         FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "authed full access" ON user_profile     FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "authed full access" ON embeddings       FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "authed full access" ON sprint_sessions  FOR ALL USING (auth.role() = 'authenticated');

-- ============================================================
-- REALTIME
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE s2d_items;
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;
