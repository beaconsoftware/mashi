import { LinearOAuthProvider } from "./providers/linear";
import { GmailOAuthProvider } from "./providers/gmail";
import { GoogleCalendarOAuthProvider } from "./providers/gcal";
import { SlackOAuthProvider } from "./providers/slack";
import { OutlookOAuthProvider } from "./providers/outlook";
import { MicrosoftCalendarOAuthProvider } from "./providers/mscal";
import { FirefliesOAuthProvider } from "./providers/fireflies";
import { SpotifyOAuthProvider } from "./providers/spotify";
import type { OAuthProvider, ProviderKey } from "./types";

/**
 * All providers Mashi can connect. New providers register themselves here.
 * Each entry is a singleton object that knows how to build authorize URLs,
 * exchange codes, refresh tokens, and label the resulting account.
 */
const PROVIDERS: Record<ProviderKey, OAuthProvider> = {
  linear: LinearOAuthProvider,
  gmail: GmailOAuthProvider,
  gcal: GoogleCalendarOAuthProvider,
  slack: SlackOAuthProvider,
  outlook: OutlookOAuthProvider,
  mscal: MicrosoftCalendarOAuthProvider,
  fireflies: FirefliesOAuthProvider,
  granola: FirefliesOAuthProvider, // placeholder — granola lacks an OAuth flow today
  notion: FirefliesOAuthProvider, // placeholder
  spotify: SpotifyOAuthProvider,
};

export function getProvider(key: string): OAuthProvider | null {
  if (!(key in PROVIDERS)) return null;
  return PROVIDERS[key as ProviderKey];
}

export function listProviders(): OAuthProvider[] {
  return Object.values(PROVIDERS).filter((p, i, arr) => arr.indexOf(p) === i);
}

export function listVisibleProviders(): OAuthProvider[] {
  // Hide placeholders until they have real flows.
  return [
    PROVIDERS.linear,
    PROVIDERS.gmail,
    PROVIDERS.gcal,
    PROVIDERS.slack,
    PROVIDERS.outlook,
    PROVIDERS.mscal,
    PROVIDERS.fireflies,
    PROVIDERS.spotify,
  ];
}
