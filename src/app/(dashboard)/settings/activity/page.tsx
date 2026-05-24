import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ActivitySettings } from "@/components/settings/activity-settings";

export const dynamic = "force-dynamic";

/**
 * Settings → Activity Monitor.
 *
 * Lets the user opt into the watcher, pause it, edit ignore lists, and
 * generate an `activity:write`-scoped API token for the Mac helper /
 * browser extension. Without this page, enabling requires SQL access.
 */
export default async function ActivitySettingsPage() {
  const supabase = await createSupabaseServerClient();

  const { data: settings } = await supabase
    .from("activity_settings")
    .select("enabled, paused_until, ignore_apps, ignore_domains")
    .maybeSingle();

  const { data: tokens } = await supabase
    .from("mashi_api_tokens")
    .select("id, name, token_prefix, scopes, created_at, last_used_at, revoked_at")
    .is("revoked_at", null)
    .order("created_at", { ascending: false });

  return (
    <div className="mx-auto max-w-3xl">
      <ActivitySettings
        initial={
          settings ?? {
            enabled: false,
            paused_until: null,
            ignore_apps: [],
            ignore_domains: [],
          }
        }
        tokens={tokens ?? []}
      />
    </div>
  );
}
