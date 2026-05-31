-- P6.d.a (Epic G2) — MCP client foundation: connected external MCP servers
-- and their discovered tool catalogue.
--
-- Mashi has long been an MCP *server* (the read-only /api/mcp/tools/* routes).
-- G2 adds an MCP *client* so a user can register external MCP servers
-- (QuickBooks, HubSpot, an internal CRM, …) and surface their tools to the
-- agent, subject to the ring model + approval gate. This first sub-row lands
-- only the persistence + discovery foundation; the loop wiring and settings UI
-- follow in later P6.d sub-rows. The whole capability is gated behind the
-- MCP_CLIENT_ENABLED flag (src/lib/flags.ts), so these tables are inert until
-- a later sub-row reads them.
--
-- mcp_servers       — one row per registered server. `credentials` is the
--                     AES-256-GCM ciphertext of the bearer token / API key
--                     (src/lib/encryption.ts), exactly like connected_accounts'
--                     OAuth tokens. NEVER selected to the browser.
-- mcp_server_tools  — the discovered tool catalogue for a server, refreshed by
--                     the discovery sync. `ring` is the conservative
--                     classification ('read' or 'write_world'); external tools
--                     never get 'write_mashi' (they cannot touch Mashi state).
--
-- Multi-tenancy: owner-only RLS, all verbs, mirroring agent_playbooks (047)
-- and agent_tool_policies (046). Every service-role discovery write sets
-- user_id explicitly and scopes reads by user_id (AGENTS.md hard rules 1, 4).
--
-- Additive + idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS public.mcp_servers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT auth.uid()
    REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Human label shown in settings.
  name TEXT NOT NULL,
  -- Lowercase hyphenated slug derived from the name; namespaces the server's
  -- tools as mcp__<slug>__<tool> so they cannot collide with built-in tool
  -- names or another server's tools. Unique per user.
  slug TEXT NOT NULL,
  -- Streamable HTTP is the current MCP transport; 'sse' is the legacy
  -- server-sent-events transport. Constrained so an unknown value cannot land.
  transport TEXT NOT NULL DEFAULT 'streamable_http'
    CHECK (transport IN ('streamable_http', 'sse')),
  url TEXT NOT NULL,
  -- AES-256-GCM ciphertext of the auth secret (bearer token / API key), or
  -- NULL for an unauthenticated server. Decrypted only server-side, only for
  -- the duration of a discovery / call request.
  credentials TEXT,
  -- Header the credential is sent under. Bearer tokens use Authorization with
  -- a 'Bearer ' prefix applied in code; some servers want a custom header.
  auth_header TEXT NOT NULL DEFAULT 'Authorization',
  enabled BOOLEAN NOT NULL DEFAULT true,
  -- Connection health, set by the discovery sync.
  status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (status IN ('unknown', 'connected', 'error')),
  last_error TEXT,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS mcp_servers_user_slug
  ON public.mcp_servers(user_id, slug);

CREATE INDEX IF NOT EXISTS mcp_servers_user_created
  ON public.mcp_servers(user_id, created_at DESC);

ALTER TABLE public.mcp_servers ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'mcp_servers'
      AND policyname = 'mcp_servers_owner'
  ) THEN
    CREATE POLICY mcp_servers_owner ON public.mcp_servers
      FOR ALL USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.mcp_server_tools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT auth.uid()
    REFERENCES auth.users(id) ON DELETE CASCADE,
  server_id UUID NOT NULL
    REFERENCES public.mcp_servers(id) ON DELETE CASCADE,
  -- The tool's name AS THE SERVER REPORTS IT (un-namespaced). The namespaced
  -- mcp__<slug>__<tool> name is derived at load time, not stored, so renaming a
  -- server's slug doesn't strand rows.
  tool_name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  -- The tool's JSON Schema for its input, as advertised by the server.
  input_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Conservative ring classification: 'read' (ring 1, no gate) or
  -- 'write_world' (ring 3, approval gate). Defaults to write_world for anything
  -- not clearly a read. Never 'write_mashi'.
  ring TEXT NOT NULL DEFAULT 'write_world'
    CHECK (ring IN ('read', 'write_world')),
  -- A user can disable an individual tool without removing the server.
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS mcp_server_tools_server_name
  ON public.mcp_server_tools(server_id, tool_name);

CREATE INDEX IF NOT EXISTS mcp_server_tools_user
  ON public.mcp_server_tools(user_id);

ALTER TABLE public.mcp_server_tools ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'mcp_server_tools'
      AND policyname = 'mcp_server_tools_owner'
  ) THEN
    CREATE POLICY mcp_server_tools_owner ON public.mcp_server_tools
      FOR ALL USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END
$$;
