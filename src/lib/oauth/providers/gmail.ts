import type { OAuthProvider, OAuthTokens, ProviderAccountInfo } from "../types";

/**
 * Gmail (Google) OAuth — same Google Cloud OAuth client as the sign-in
 * provider, but with additional scopes the user must grant when they
 * "Connect another Gmail" in settings.
 *
 * For multi-account: each Gmail inbox is a separate connection. Google's
 * OAuth flow always shows an account picker, so connecting Beacon's inbox
 * then Acuity's inbox is two separate clicks of "Connect Gmail".
 */

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

export const GmailOAuthProvider: OAuthProvider = {
  meta: {
    key: "gmail",
    label: "Gmail",
    description: "Connect each portco inbox you have access to.",
    supportsMultiple: true,
    brandColor: "#EA4335",
  },

  defaultScopes: [
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.modify",
  ],

  buildAuthorizeUrl({ state, redirectUri, scopes }) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) throw new Error("GOOGLE_CLIENT_ID is not set");
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: scopes.join(" "),
      access_type: "offline", // refresh tokens
      prompt: "consent select_account", // force account picker
      state,
      include_granted_scopes: "true",
    });
    return `${AUTH_URL}?${params.toString()}`;
  },

  async exchangeCode({ code, redirectUri }): Promise<OAuthTokens> {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        code,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Google token exchange failed: ${res.status} ${text}`);
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
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });
    if (!res.ok) throw new Error(`Google refresh failed: ${res.status}`);
    const j = (await res.json()) as {
      access_token: string;
      token_type: string;
      scope?: string;
      expires_in?: number;
    };
    return {
      accessToken: j.access_token,
      refreshToken,
      tokenType: j.token_type,
      scopes: j.scope?.split(/\s+/) ?? [],
      expiresAt: j.expires_in ? new Date(Date.now() + j.expires_in * 1000) : undefined,
    };
  },

  async fetchAccountInfo(tokens): Promise<ProviderAccountInfo> {
    const res = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    if (!res.ok) throw new Error(`Google userinfo failed: ${res.status}`);
    const j = (await res.json()) as {
      sub: string;
      email: string;
      name?: string;
      picture?: string;
    };
    return {
      externalId: j.sub,
      accountEmail: j.email,
      accountLabel: j.email,
      accountAvatarUrl: j.picture,
    };
  },
};
