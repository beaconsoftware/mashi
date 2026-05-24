import { TopBar } from "@/components/layout/top-bar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ActivitySettings } from "@/components/settings/activity-settings";

export const dynamic = "force-dynamic";

/**
 * Settings → Activity Watcher.
 *
 * Lets the user opt into the watcher, pause it, edit ignore lists, and
 * generate an `activity:write`-scoped API token for the (future) Mac
 * helper / browser extension. Without this page, enabling requires SQL
 * access.
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
    <>
      <TopBar
        title="Activity Watcher"
        subtitle="Passive presence — Mashi suggests state changes, you approve them."
      />
      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-3xl px-6 py-8">
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
      </ScrollArea>
    </>
  );
}
