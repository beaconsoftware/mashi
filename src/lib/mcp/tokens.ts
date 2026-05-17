/**
 * Mashi API token utilities. Used by:
 *   - /api/mcp/tokens routes (CRUD)
 *   - /api/mcp/* tool endpoints (verify)
 *
 * Plaintext format: `mashi_pat_<32 bytes base64url>` (~52 chars total).
 * The prefix is the brand marker so leaked tokens are obvious in logs
 * (and so we can find them via GitHub secret scanning later if we
 * register the pattern).
 *
 * Only sha256(plaintext) is stored; plaintext is shown once at
 * generation and otherwise unrecoverable. Lost = revoke + regenerate.
 */
import { randomBytes, createHash } from "node:crypto";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const TOKEN_PREFIX = "mashi_pat_";

export function generateToken(): { plaintext: string; hash: string; prefix: string } {
  const raw = randomBytes(32).toString("base64url");
  const plaintext = `${TOKEN_PREFIX}${raw}`;
  const hash = createHash("sha256").update(plaintext).digest("hex");
  const prefix = plaintext.slice(0, 16); // "mashi_pat_AbCd" — enough to identify, not enough to use
  return { plaintext, hash, prefix };
}

export function hashToken(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

/**
 * Resolve an inbound bearer token to a user_id. Returns null if invalid
 * or revoked. Updates last_used_at as a side effect (best-effort; non-
 * blocking, errors swallowed).
 *
 * Service-role client because token verification happens BEFORE we know
 * which user we're acting as.
 */
export async function verifyToken(plaintext: string): Promise<{
  userId: string;
  tokenId: string;
  scopes: string[];
} | null> {
  if (!plaintext.startsWith(TOKEN_PREFIX)) return null;
  const hash = hashToken(plaintext);
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("mashi_api_tokens")
    .select("id, user_id, scopes, revoked_at")
    .eq("token_hash", hash)
    .maybeSingle();
  if (error || !data) return null;
  if (data.revoked_at) return null;

  // Fire-and-forget last_used_at update — don't block the request
  void sb
    .from("mashi_api_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id);

  return { userId: data.user_id, tokenId: data.id, scopes: data.scopes ?? ["read"] };
}

/**
 * Extract the bearer token from a Next.js request's Authorization header.
 * Returns the raw plaintext, or null if absent / malformed.
 */
export function bearerFromRequest(req: Request): string | null {
  const h = req.headers.get("authorization");
  if (!h) return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  return m[1].trim();
}
