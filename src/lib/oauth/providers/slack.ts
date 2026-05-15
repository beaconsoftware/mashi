import type { OAuthProvider, OAuthTokens, ProviderAccountInfo } from "../types";

/**
 * Slack OAuth v2 — https://api.slack.com/authentication/oauth-v2
 *
 * Multi-workspace: each Slack workspace is a separate connection. The
 * "Add to Slack" button shows a workspace picker.
 *
 * Scopes are split into "user" and "bot" scopes. We use user scopes so
 * Mashi reads messages from the user's perspective (their DMs, their
 * channel memberships) rather than as a bot.
 */

const AUTH_URL = "https://slack.com/oauth/v2/authorize";
const TOKEN_URL = "https://slack.com/api/oauth.v2.access";
const AUTH_TEST_URL = "https://slack.com/api/auth.test";
const TEAM_INFO_URL = "https://slack.com/api/team.info";

const USER_SCOPES = [
  "channels:history",
  "channels:read",
  "groups:history",
  "groups:read",
  "im:history",
  "im:read",
  "mpim:history",
  "mpim:read",
  "users:read",
  "users:read.email",
  "chat:write",
];

export const SlackOAuthProvider: OAuthProvider = {
  meta: {
    key: "slack",
    label: "Slack",
    description: "Connect Beacon + each portco workspace.",
    supportsMultiple: true,
    brandColor: "#4A154B",
  },

  defaultScopes: USER_SCOPES,

  buildAuthorizeUrl({ state, redirectUri, scopes }) {
    const clientId = process.env.SLACK_CLIENT_ID;
    if (!clientId) throw new Error("SLACK_CLIENT_ID is not set");
    const params = new URLSearchParams({
      client_id: clientId,
      user_scope: scopes.join(","),
      redirect_uri: redirectUri,
      state,
    });
    return `${AUTH_URL}?${params.toString()}`;
  },

  async exchangeCode({ code, redirectUri }): Promise<OAuthTokens> {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.SLACK_CLIENT_ID!,
        client_secret: process.env.SLACK_CLIENT_SECRET!,
        redirect_uri: redirectUri,
        code,
      }),
    });
    const j = (await res.json()) as {
      ok: boolean;
      error?: string;
      authed_user?: {
        id: string;
        access_token: string;
        token_type: string;
        scope: string;
      };
      team?: { id: string; name: string };
    };
    if (!j.ok || !j.authed_user) {
      throw new Error(`Slack token exchange failed: ${j.error ?? "unknown"}`);
    }
    return {
      accessToken: j.authed_user.access_token,
      tokenType: j.authed_user.token_type,
      scopes: j.authed_user.scope.split(/,/),
    };
  },

  async fetchAccountInfo(tokens): Promise<ProviderAccountInfo> {
    const authRes = await fetch(AUTH_TEST_URL, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    const auth = (await authRes.json()) as {
      ok: boolean;
      team_id?: string;
      team?: string;
      url?: string;
      user_id?: string;
    };
    if (!auth.ok || !auth.team_id) {
      throw new Error("Slack auth.test failed");
    }
    // Fetch richer team metadata (icon)
    const teamRes = await fetch(TEAM_INFO_URL, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    const team = (await teamRes.json()) as {
      ok: boolean;
      team?: { id: string; name: string; icon?: { image_88?: string } };
    };
    return {
      externalId: auth.team_id,
      accountLabel: team.team?.name ?? auth.team ?? "Slack workspace",
      accountAvatarUrl: team.team?.icon?.image_88,
      rawProviderData: { auth, team },
    };
  },
};
