import type { OAuthProvider } from "../types";
import { OutlookOAuthProvider } from "./outlook";

/**
 * Microsoft Calendar reuses the Outlook OAuth client with a different
 * scope set — same approach as Google Gmail / Google Calendar.
 */
export const MicrosoftCalendarOAuthProvider: OAuthProvider = {
  ...OutlookOAuthProvider,
  meta: {
    key: "mscal",
    label: "Microsoft Calendar",
    description: "Outlook / M365 calendars for meeting prep.",
    supportsMultiple: true,
    brandColor: "#0364B8",
  },
  defaultScopes: [
    "openid",
    "profile",
    "offline_access",
    "User.Read",
    "Calendars.Read",
    "Calendars.ReadWrite",
  ],
};
