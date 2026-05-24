import { redirect } from "next/navigation";

/**
 * /settings is a bare entry-point — the actual sections live under
 * /settings/connections, /settings/activity, etc. Redirect to the first
 * one so the sub-nav always has an active item highlighted.
 */
export default function SettingsIndexPage() {
  redirect("/settings/connections");
}
