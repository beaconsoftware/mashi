import type { OAuthProvider, OAuthTokens, ProviderAccountInfo } from "../types";

/**
 * Linear — personal API key flow.
 *
 * Linear's OAuth tokens expire after ~24h and they don't issue refresh
 * tokens, which is unworkable for a daily-driver tool. We use personal
 * API keys instead (Linear Settings → API → "Personal API keys"). These
 * never expire and are scoped per Linear workspace, so the user creates
 * one key per portco workspace.
 *
 * The OAuth shape is preserved for framework consistency — `buildAuthorizeUrl`
 * returns the mashi:// sentinel that the generic /api/connect/[provider]
 * route intercepts to show the API-key entry dialog (same machinery as
 * Fireflies).
 */

const GRAPHQL_URL = "https://api.linear.app/graphql";

export const LinearOAuthProvider: OAuthProvider = {
  meta: {
    key: "linear",
    label: "Linear",
    description: "Issues + projects from every portco workspace.",
    supportsMultiple: true,
    brandColor: "#5E6AD2",
  },

  defaultScopes: ["read", "write", "issues:create", "comments:create"],

  buildAuthorizeUrl() {
    // Sentinel — the /api/connect/[provider] route intercepts this and
    // redirects to /settings/connections?dialog=linear, which opens the
    // ApiKeyDialog.
    return "mashi://api-key-dialog/linear";
  },

  async exchangeCode({ code }): Promise<OAuthTokens> {
    // `code` is the user-pasted personal API key. Linear keys don't expire,
    // so we don't stamp an expires_at.
    return { accessToken: code };
  },

  async fetchAccountInfo(tokens): Promise<ProviderAccountInfo> {
    const res = await fetch(GRAPHQL_URL, {
      method: "POST",
      headers: {
        Authorization: tokens.accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: `query { viewer { id email name } organization { id name urlKey logoUrl } }`,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Linear viewer fetch failed: ${res.status} ${text.slice(0, 200)}`);
    }
    const j = (await res.json()) as {
      data?: {
        viewer?: { id: string; email: string; name: string };
        organization?: { id: string; name: string; urlKey: string; logoUrl?: string };
      };
      errors?: unknown;
    };
    if (j.errors || !j.data?.viewer || !j.data?.organization) {
      throw new Error(
        "Linear API key validation failed (no viewer/organization returned). Check the key has 'read' scope."
      );
    }
    return {
      externalId: j.data.organization.id,
      accountEmail: j.data.viewer.email,
      accountLabel: j.data.organization.name,
      accountAvatarUrl: j.data.organization.logoUrl,
      rawProviderData: {
        org: j.data.organization,
        viewer: j.data.viewer,
      },
    };
  },
};
