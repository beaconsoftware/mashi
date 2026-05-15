/**
 * Provider-agnostic OAuth types used by the connections framework.
 * Each provider implementation in src/lib/oauth/providers/*.ts implements
 * `OAuthProvider`.
 */

export type ProviderKey =
  | "gmail"
  | "gcal"
  | "outlook"
  | "mscal"
  | "slack"
  | "linear"
  | "fireflies"
  | "granola"
  | "notion";

export interface ProviderMeta {
  key: ProviderKey;
  /** Human-friendly name shown in the Connections UI. */
  label: string;
  /** Short description shown under the label. */
  description: string;
  /** Whether one user can have multiple connections for this provider. */
  supportsMultiple: boolean;
  /** Brand color (hex) used as the icon background. */
  brandColor: string;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  scopes?: string[];
  expiresAt?: Date;
}

export interface ProviderAccountInfo {
  /** Provider's stable identifier for this account/org/workspace. */
  externalId: string;
  /** Email if applicable, otherwise empty string. */
  accountEmail?: string;
  /** Display label (e.g. workspace name, org name). */
  accountLabel: string;
  /** Optional avatar URL. */
  accountAvatarUrl?: string;
  /** Provider-specific blob to preserve in raw_provider_data. */
  rawProviderData?: Record<string, unknown>;
}

export interface OAuthProvider {
  meta: ProviderMeta;

  /** Default scopes when the user clicks "Connect". */
  defaultScopes: string[];

  /**
   * Build the URL the user is redirected to in order to grant access.
   * `state` is opaque — Mashi stashes it in `oauth_flow_states` so callback
   * can correlate the response.
   */
  buildAuthorizeUrl(opts: {
    state: string;
    redirectUri: string;
    scopes: string[];
  }): string;

  /** Exchange the callback `code` for tokens. */
  exchangeCode(opts: {
    code: string;
    redirectUri: string;
  }): Promise<OAuthTokens>;

  /** Refresh an expired access token. Returns new tokens. */
  refresh?(refreshToken: string): Promise<OAuthTokens>;

  /** Once we have tokens, fetch the account info to label the connection. */
  fetchAccountInfo(tokens: OAuthTokens): Promise<ProviderAccountInfo>;
}
