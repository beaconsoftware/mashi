import { SettingsShell } from "@/components/settings/settings-shell";

/**
 * Settings layout. Replaces the five separate top-level pages with one
 * page-frame: TopBar + left sub-nav + content panel. Each child page now
 * renders only its content (no own TopBar / ScrollArea wrapper).
 *
 * Old URLs (/settings/connections, /settings/style, /settings/usage,
 * /settings/activity, /settings/api-tokens) still resolve — they're now
 * the children rendered inside this layout, not standalone pages.
 */
export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <SettingsShell>{children}</SettingsShell>;
}
