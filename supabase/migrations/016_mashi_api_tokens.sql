-- Per-user API tokens for the Mashi DXT (Claude Desktop extension) and
-- any other external MCP / agent consumer.
--
-- Auth model:
--   - User generates a named token via /settings/api-tokens
--   - The plaintext value (mashi_pat_<32 random bytes base64url>) is
--     shown ONCE at generation, then discarded; only sha256(plaintext)
--     is stored. Lost tokens cannot be recovered, only revoked + replaced.
--   - The DXT (or any client) sends `Authorization: Bearer mashi_pat_...`
--     on every request. Server hashes the value and looks it up.
--   - Token row carries user_id; once resolved, every downstream query
--     scopes by it. No service-role cross-tenant access from MCP.

CREATE TABLE IF NOT EXISTS public.mashi_api_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  -- sha256 hex of the plaintext token. 64 chars.
  token_hash    TEXT NOT NULL UNIQUE,
  -- First 12 chars of the plaintext, for display in the UI ("mashi_pat_AbCd…"),
  -- so the user can identify which token is which without revealing the secret.
  token_prefix  TEXT NOT NULL,
  scopes        TEXT[] NOT NULL DEFAULT ARRAY['read']::TEXT[],
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at  TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_mashi_api_tokens_user
  ON public.mashi_api_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_mashi_api_tokens_hash
  ON public.mashi_api_tokens (token_hash)
  WHERE revoked_at IS NULL;

-- RLS: owner-only, same as every other multi-tenant table
ALTER TABLE public.mashi_api_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own tokens" ON public.mashi_api_tokens;
CREATE POLICY "own tokens" ON public.mashi_api_tokens
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
