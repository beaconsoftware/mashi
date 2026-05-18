import { createSupabaseServiceClient } from "@/lib/supabase/server";

/**
 * Best-effort string extraction for whatever a sync function might have
 * thrown. The provider-specific catch blocks all used `err instanceof Error
 * ? err.message : "X sync failed"` which silently hid Supabase PostgrestError
 * objects, plain-object throws, and string throws — so the DB ended up with
 * useless generic messages. This unwraps the common shapes and falls back
 * to a JSON.stringify so something diagnostic always lands in last_sync_error.
 */
export function formatSyncError(err: unknown, providerLabel: string): string {
  if (err instanceof Error) {
    // Error.message is usually enough; include cause when present.
    const causeMsg =
      err.cause instanceof Error ? ` (cause: ${err.cause.message})` : "";
    return `${err.message}${causeMsg}`;
  }
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const o = err as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown };
    // Supabase PostgrestError shape.
    if (typeof o.message === "string") {
      const code = typeof o.code === "string" ? ` [${o.code}]` : "";
      const hint = typeof o.hint === "string" ? ` — ${o.hint}` : "";
      return `${o.message}${code}${hint}`;
    }
    try {
      return JSON.stringify(o).slice(0, 400);
    } catch {
      /* fall through */
    }
  }
  return `${providerLabel} sync failed (no error detail)`;
}

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
