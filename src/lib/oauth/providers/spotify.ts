import type { OAuthProvider, OAuthTokens, ProviderAccountInfo } from "../types";

/**
 * Spotify OAuth, https://developer.spotify.com/documentation/web-api/tutorials/code-flow
 *
 * Authorization Code flow. Access tokens expire after 1 hour; refresh
 * tokens DO NOT expire unless the user explicitly revokes access from
 * their account page, much friendlier than Google's Testing-mode 7-day
 * expiry.
 *
 * Single connection per user.
 */

const AUTH_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const PROFILE_URL = "https://api.spotify.com/v1/me";

const SCOPES = [
  "user-read-playback-state",
  "user-read-currently-playing",
  "user-read-recently-played",
  "user-modify-playback-state",
  "playlist-read-private",
  "playlist-modify-public",
  "playlist-modify-private",
];

export const SpotifyOAuthProvider: OAuthProvider = {
  meta: {
    key: "spotify",
    label: "Spotify",
    description: "Music control + ambient art for sprint focus mode.",
    supportsMultiple: false,
    brandColor: "#1DB954",
  },

  defaultScopes: SCOPES,

  buildAuthorizeUrl({ state, redirectUri, scopes }) {
    const clientId = process.env.SPOTIFY_CLIENT_ID;
    if (!clientId) throw new Error("SPOTIFY_CLIENT_ID is not set");
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: scopes.join(" "),
      state,
      show_dialog: "true",
    });
    return `${AUTH_URL}?${params.toString()}`;
  },

  async exchangeCode({ code, redirectUri }): Promise<OAuthTokens> {
    const clientId = process.env.SPOTIFY_CLIENT_ID!;
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET!;
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Spotify token exchange failed: ${res.status} ${text.slice(0, 200)}`);
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
    const clientId = process.env.SPOTIFY_CLIENT_ID!;
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET!;
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let parsed: { error?: string; error_description?: string } = {};
      try {
        parsed = JSON.parse(text);
      } catch {
        /* not JSON */
      }
      const code = parsed.error ?? "";
      const desc = parsed.error_description ?? text.slice(0, 200);
      throw new Error(
        `Spotify refresh failed: ${res.status}${code ? ` ${code}` : ""}${desc ? `, ${desc}` : ""}`
      );
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
      refreshToken: j.refresh_token ?? refreshToken,
      tokenType: j.token_type,
      scopes: j.scope?.split(/\s+/) ?? [],
      expiresAt: j.expires_in ? new Date(Date.now() + j.expires_in * 1000) : undefined,
    };
  },

  async fetchAccountInfo(tokens): Promise<ProviderAccountInfo> {
    const res = await fetch(PROFILE_URL, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    if (!res.ok) throw new Error(`Spotify /me failed: ${res.status}`);
    const j = (await res.json()) as {
      id: string;
      email?: string;
      display_name?: string;
      images?: Array<{ url: string }>;
      product?: string;
    };
    const avatar = j.images && j.images.length > 0 ? j.images[0].url : undefined;
    return {
      externalId: j.id,
      accountEmail: j.email,
      accountLabel: j.display_name ?? j.email ?? j.id,
      accountAvatarUrl: avatar,
      rawProviderData: { product: j.product ?? null },
    };
  },
};
