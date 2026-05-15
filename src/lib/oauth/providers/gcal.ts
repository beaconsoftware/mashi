import type { OAuthProvider } from "../types";
import { GmailOAuthProvider } from "./gmail";

/**
 * Google Calendar uses the same Google OAuth flow as Gmail, with a
 * different scope set. We reuse the Gmail provider's implementation but
 * advertise it as a separate connection so the user knows what they're
 * granting and can connect calendars independently from mail.
 */
export const GoogleCalendarOAuthProvider: OAuthProvider = {
  ...GmailOAuthProvider,
  meta: {
    key: "gcal",
    label: "Google Calendar",
    description: "Per-account calendar sync for meeting prep.",
    supportsMultiple: true,
    brandColor: "#4285F4",
  },
  defaultScopes: [
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/calendar.events",
  ],
};
