import { createSupabaseServiceClient } from "@/lib/supabase/server";

/**
 * Detect whether an error message indicates the provider rejected our token
 * (401/403/expired/revoked). When that happens we mark the connection
 * `needs_reauth` so the UI shows a Reconnect button instead of a generic
 * error.
 */
export function looksLikeAuthFailure(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("401") ||
    m.includes("403") ||
    m.includes("unauthorized") ||
    m.includes("invalid_token") ||
    m.includes("invalid_grant") ||
    m.includes("token expired") ||
    m.includes("token_expired") ||
    m.includes("authentication required")
  );
}

/**
 * Mark a connection as needing re-authorization. Stamps the original error
 * message into last_sync_error for debuggability.
 */
export async function markNeedsReauth(connectionId: string, errorMsg: string): Promise<void> {
  const supabase = createSupabaseServiceClient();
  await supabase
    .from("connected_accounts")
    .update({
      last_sync_status: "needs_reauth",
      last_sync_error: errorMsg.slice(0, 500),
    })
    .eq("id", connectionId);
}

/**
 * Wrap a sync function so any auth-failure errors land as needs_reauth
 * instead of generic error. Re-throws afterwards so the caller still gets
 * the exception (sync routes return 500).
 */
export async function withReauthGuard<T>(
  connectionId: string,
  fn: () => Promise<T>
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (looksLikeAuthFailure(msg)) {
      await markNeedsReauth(connectionId, msg);
    }
    throw err;
  }
}

/**
 * Route a sync-time failure to the right last_sync_status. Auth failures
 * become 'needs_reauth'; everything else stays 'error'.
 */
export async function recordSyncFailure(
  connectionId: string,
  msg: string
): Promise<void> {
  const supabase = createSupabaseServiceClient();
  await supabase
    .from("connected_accounts")
    .update({
      last_sync_status: looksLikeAuthFailure(msg) ? "needs_reauth" : "error",
      last_sync_error: msg.slice(0, 500),
    })
    .eq("id", connectionId);
}
