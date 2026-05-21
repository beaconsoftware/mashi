import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getActiveAccessToken } from "@/lib/oauth/flow";

/**
 * Helpers for talking to Spotify on behalf of a Mashi user.
 *
 * All routes go through `spotifyFetch` so token refresh + 401 handling
 * live in one place. The caller passes the Mashi `userId` and we look
 * up that user's single Spotify connection from `connected_accounts`.
 *
 * Multi-tenancy note: we use the service client because the OAuth token
 * is encrypted in a service-scoped path, but EVERY query filters by
 * `user_id` to enforce isolation — service-role bypasses RLS.
 */

export const SPOTIFY_API = "https://api.spotify.com/v1";

export interface SpotifyConnection {
  connectionId: string;
  product: string | null; // 'premium' | 'free' | 'open'
}

export async function getSpotifyConnection(userId: string): Promise<SpotifyConnection | null> {
  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from("connected_accounts")
    .select("id, raw_provider_data")
    .eq("user_id", userId)
    .eq("provider", "spotify")
    .maybeSingle();
  if (!data) return null;
  const rpd = (data.raw_provider_data as { product?: string } | null) ?? null;
  return {
    connectionId: data.id,
    product: rpd?.product ?? null,
  };
}

/**
 * Wrapped Spotify fetch that handles auth header + 401 retry after
 * token refresh. Returns the raw Response; the caller decides whether
 * to expect JSON, no content (204), or something else.
 *
 * 401 retry: if Spotify says the access token is bad, `getActiveAccessToken`
 * already refreshes when expired but might race with a server-side
 * revocation. One retry covers the gap.
 *
 * 204 / 202 are common from `/me/player/*` mutations and mean "request
 * queued, no body" — callers should treat them as success.
 */
export async function spotifyFetch(
  userId: string,
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const conn = await getSpotifyConnection(userId);
  if (!conn) {
    return new Response(JSON.stringify({ error: "no_spotify_connection" }), {
      status: 412,
      headers: { "Content-Type": "application/json" },
    });
  }
  let token = await getActiveAccessToken(conn.connectionId);
  let res = await fetch(`${SPOTIFY_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 401) {
    // Force a refresh by clearing the expires_at, then re-pull.
    const sb = createSupabaseServiceClient();
    await sb
      .from("connected_accounts")
      .update({ expires_at: new Date(0).toISOString() })
      .eq("id", conn.connectionId)
      .eq("user_id", userId);
    token = await getActiveAccessToken(conn.connectionId);
    res = await fetch(`${SPOTIFY_API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.headers ?? {}),
      },
    });
  }
  return res;
}

/**
 * Common Premium-only operations return 403 with a body like
 *   { error: { status: 403, reason: "PREMIUM_REQUIRED" } }
 * This helper teases that out so the UI can render a friendly message.
 */
export async function readSpotifyError(res: Response): Promise<{
  status: number;
  reason: string | null;
  message: string;
}> {
  let body: { error?: { status?: number; reason?: string; message?: string } } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    /* not JSON */
  }
  return {
    status: body.error?.status ?? res.status,
    reason: body.error?.reason ?? null,
    message: body.error?.message ?? `Spotify ${res.status}`,
  };
}
