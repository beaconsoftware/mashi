import { randomBytes } from "node:crypto";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";
import { encrypt } from "@/lib/encryption";
import { getProvider } from "./registry";
import type { OAuthTokens, ProviderKey } from "./types";

// Note: || (not ??) so an empty-string env var falls back. Vercel can
// store a NEXT_PUBLIC_APP_URL row with no value, which ?? would happily
// leave as "" and produce relative redirect_uris that OAuth providers reject.
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3456";

export function callbackUrl(provider: ProviderKey): string {
  return `${APP_URL}/api/connect/${provider}/callback`;
}

/**
 * Begin an OAuth flow for a provider. Stashes a `state` token in
 * oauth_flow_states (10-minute TTL) so the callback can correlate.
 *
 * Returns the URL the user should be redirected to. For providers using
 * the mashi://api-key-dialog pseudo-flow (e.g. Fireflies), the caller
 * intercepts this and shows the API-key entry dialog instead.
 */
export async function startOAuthFlow(opts: {
  provider: ProviderKey;
  redirectAfter?: string;
  extraScopes?: string[];
}): Promise<{ url: string; state: string }> {
  const provider = getProvider(opts.provider);
  if (!provider) throw new Error(`Unknown provider: ${opts.provider}`);

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const state = randomBytes(24).toString("base64url");
  const scopes = [...new Set([...provider.defaultScopes, ...(opts.extraScopes ?? [])])];

  await supabase.from("oauth_flow_states").insert({
    state,
    user_id: user.id,
    provider: opts.provider,
    redirect_after: opts.redirectAfter ?? "/settings/connections",
  });

  const url = provider.buildAuthorizeUrl({
    state,
    redirectUri: callbackUrl(opts.provider),
    scopes,
  });

  return { url, state };
}

/**
 * Complete an OAuth flow after the provider redirects back with a code.
 * Verifies state, exchanges the code, fetches account info, and stores
 * an encrypted-token row in connected_accounts.
 *
 * For the Fireflies-style API-key flow, `code` is the user-entered key.
 */
export async function completeOAuthFlow(opts: {
  provider: ProviderKey;
  code: string;
  state: string;
}): Promise<{ connectionId: string; redirectAfter: string }> {
  const provider = getProvider(opts.provider);
  if (!provider) throw new Error(`Unknown provider: ${opts.provider}`);

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const { data: stateRow, error: stateErr } = await supabase
    .from("oauth_flow_states")
    .select("user_id, provider, redirect_after, expires_at")
    .eq("state", opts.state)
    .maybeSingle();

  if (stateErr) throw stateErr;
  if (!stateRow) throw new Error("Invalid or expired OAuth state");
  if (stateRow.user_id !== user.id) throw new Error("OAuth state user mismatch");
  if (stateRow.provider !== opts.provider) throw new Error("OAuth state provider mismatch");
  if (new Date(stateRow.expires_at).getTime() < Date.now()) {
    throw new Error("OAuth state expired");
  }

  // Burn the state token immediately so it can't be reused.
  await supabase.from("oauth_flow_states").delete().eq("state", opts.state);

  const tokens: OAuthTokens = await provider.exchangeCode({
    code: opts.code,
    redirectUri: callbackUrl(opts.provider),
  });

  const info = await provider.fetchAccountInfo(tokens);

  // Upsert: connecting the same account/org twice updates the existing row.
  const { data: existing } = await supabase
    .from("connected_accounts")
    .select("id")
    .eq("user_id", user.id)
    .eq("provider", opts.provider)
    .eq("external_id", info.externalId)
    .maybeSingle();

  const row = {
    user_id: user.id,
    provider: opts.provider,
    external_id: info.externalId,
    account_email: info.accountEmail ?? null,
    account_label: info.accountLabel,
    account_avatar_url: info.accountAvatarUrl ?? null,
    access_token_encrypted: encrypt(tokens.accessToken),
    refresh_token_encrypted: tokens.refreshToken ? encrypt(tokens.refreshToken) : null,
    token_type: tokens.tokenType ?? null,
    scopes: tokens.scopes ?? [],
    expires_at: tokens.expiresAt?.toISOString() ?? null,
    raw_provider_data: info.rawProviderData ?? {},
    last_sync_status: "idle" as const,
    last_sync_error: null,
  };

  let connectionId: string;
  if (existing) {
    const { error } = await supabase
      .from("connected_accounts")
      .update(row)
      .eq("id", existing.id);
    if (error) throw error;
    connectionId = existing.id;
  } else {
    const { data, error } = await supabase
      .from("connected_accounts")
      .insert(row)
      .select("id")
      .single();
    if (error) throw error;
    connectionId = data.id;
  }

  return { connectionId, redirectAfter: stateRow.redirect_after ?? "/settings/connections" };
}

/**
 * Decrypt and (if needed) refresh the access token for a connection.
 * Updates the row when refresh produces new tokens.
 */
export async function getActiveAccessToken(connectionId: string): Promise<string> {
  // Service client: this function manages OAuth tokens by connection ID and
  // is called from background jobs (reconcile, sync) that may run outside a
  // request scope. RLS doesn't add safety here — the connection ID itself
  // is the authority.
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("connected_accounts")
    .select(
      "id, provider, access_token_encrypted, refresh_token_encrypted, expires_at"
    )
    .eq("id", connectionId)
    .single();
  if (error) throw error;

  const { decrypt } = await import("@/lib/encryption");
  const provider = getProvider(data.provider);
  if (!provider) throw new Error(`Unknown provider on connection: ${data.provider}`);

  const expiresAt = data.expires_at ? new Date(data.expires_at).getTime() : null;
  const isExpired = expiresAt != null && expiresAt < Date.now() + 60_000; // 60s grace

  if (!isExpired || !data.refresh_token_encrypted || !provider.refresh) {
    return decrypt(data.access_token_encrypted!);
  }

  // Refresh
  const fresh = await provider.refresh(decrypt(data.refresh_token_encrypted));
  await supabase
    .from("connected_accounts")
    .update({
      access_token_encrypted: encrypt(fresh.accessToken),
      refresh_token_encrypted: fresh.refreshToken
        ? encrypt(fresh.refreshToken)
        : data.refresh_token_encrypted,
      expires_at: fresh.expiresAt?.toISOString() ?? null,
      token_type: fresh.tokenType ?? null,
    })
    .eq("id", connectionId);
  return fresh.accessToken;
}
