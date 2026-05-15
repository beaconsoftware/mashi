import type { OAuthProvider, OAuthTokens, ProviderAccountInfo } from "../types";

/**
 * Fireflies doesn't expose a public OAuth client-credentials flow today —
 * users typically connect via a personal API key from their Fireflies
 * settings (https://app.fireflies.ai/settings → Developer Settings →
 * generate API key).
 *
 * For multi-account: if the user has separate Fireflies accounts for
 * Beacon and each portco, each gets its own API key and its own connection.
 *
 * The "OAuth" flow here is a synthetic one: the connect button pops a
 * dialog asking for the API key, we validate it against the GraphQL API,
 * and store it as the `access_token`.
 *
 * Implemented as an OAuthProvider so the connections framework treats it
 * uniformly. `buildAuthorizeUrl` returns the mashi:// pseudo-URL that the
 * UI intercepts to show the API-key dialog.
 */

const GRAPHQL_URL = "https://api.fireflies.ai/graphql";

export const FirefliesOAuthProvider: OAuthProvider = {
  meta: {
    key: "fireflies",
    label: "Fireflies",
    description: "Meeting transcripts and action items.",
    supportsMultiple: true,
    brandColor: "#FFA500",
  },

  defaultScopes: ["transcripts:read"],

  buildAuthorizeUrl() {
    // Sentinel — the Connections UI checks for this exact prefix and
    // shows the API-key entry dialog instead of redirecting to a browser.
    return "mashi://api-key-dialog/fireflies";
  },

  async exchangeCode({ code }): Promise<OAuthTokens> {
    // `code` is the user-pasted API key.
    return { accessToken: code };
  },

  async fetchAccountInfo(tokens): Promise<ProviderAccountInfo> {
    const res = await fetch(GRAPHQL_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: `query { user { user_id email name } }` }),
    });
    if (!res.ok) {
      throw new Error(`Fireflies API key check failed: ${res.status}`);
    }
    const j = (await res.json()) as {
      data?: { user?: { user_id: string; email: string; name?: string } };
      errors?: unknown;
    };
    const u = j.data?.user;
    if (!u) {
      throw new Error("Fireflies API key is invalid (no user returned).");
    }
    return {
      externalId: u.user_id,
      accountEmail: u.email,
      accountLabel: u.name ? `${u.name} · ${u.email}` : u.email,
    };
  },
};
