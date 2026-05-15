import type { OAuthProvider, OAuthTokens, ProviderAccountInfo } from "../types";

/**
 * Microsoft / Outlook OAuth via Microsoft Identity Platform v2.
 * https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
 *
 * Uses the "common" tenant so users from any work or personal account can
 * authorize. Each Outlook inbox is a separate connection.
 */

const TENANT = process.env.AZURE_AD_TENANT_ID || "common";
const AUTH_URL = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`;
const TOKEN_URL = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`;
const ME_URL = "https://graph.microsoft.com/v1.0/me";

export const OutlookOAuthProvider: OAuthProvider = {
  meta: {
    key: "outlook",
    label: "Outlook",
    description: "Connect each Outlook inbox you have access to.",
    supportsMultiple: true,
    brandColor: "#0078D4",
  },

  defaultScopes: [
    "openid",
    "profile",
    "offline_access",
    "User.Read",
    "Mail.Read",
    "Mail.Send",
  ],

  buildAuthorizeUrl({ state, redirectUri, scopes }) {
    const clientId = process.env.AZURE_AD_CLIENT_ID;
    if (!clientId) throw new Error("AZURE_AD_CLIENT_ID is not set");
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      response_mode: "query",
      scope: scopes.join(" "),
      state,
      prompt: "select_account",
    });
    return `${AUTH_URL}?${params.toString()}`;
  },

  async exchangeCode({ code, redirectUri }): Promise<OAuthTokens> {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.AZURE_AD_CLIENT_ID!,
        client_secret: process.env.AZURE_AD_CLIENT_SECRET!,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        code,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Microsoft token exchange failed: ${res.status} ${text}`);
    }
    const j = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      token_type: string;
      scope?: string;
      expires_in?: number;
    };
    return {
      accessToken: j.access_token,
      refreshToken: j.refresh_token,
      tokenType: j.token_type,
      scopes: j.scope?.split(/\s+/) ?? [],
      expiresAt: j.expires_in ? new Date(Date.now() + j.expires_in * 1000) : undefined,
    };
  },

  async refresh(refreshToken: string): Promise<OAuthTokens> {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.AZURE_AD_CLIENT_ID!,
        client_secret: process.env.AZURE_AD_CLIENT_SECRET!,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });
    if (!res.ok) throw new Error(`Microsoft refresh failed: ${res.status}`);
    const j = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      token_type: string;
      scope?: string;
      expires_in?: number;
    };
    return {
      accessToken: j.access_token,
      refreshToken: j.refresh_token ?? refreshToken,
      tokenType: j.token_type,
      scopes: j.scope?.split(/\s+/) ?? [],
      expiresAt: j.expires_in ? new Date(Date.now() + j.expires_in * 1000) : undefined,
    };
  },

  async fetchAccountInfo(tokens): Promise<ProviderAccountInfo> {
    const res = await fetch(ME_URL, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    if (!res.ok) throw new Error(`Microsoft /me failed: ${res.status}`);
    const j = (await res.json()) as {
      id: string;
      mail?: string;
      userPrincipalName?: string;
      displayName?: string;
    };
    const email = j.mail ?? j.userPrincipalName ?? "";
    return {
      externalId: j.id,
      accountEmail: email,
      accountLabel: email || j.displayName || "Outlook account",
    };
  },
};
