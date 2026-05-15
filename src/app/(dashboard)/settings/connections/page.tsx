import { TopBar } from "@/components/layout/top-bar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ConnectionsManager } from "@/components/settings/connections-manager";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function ConnectionsSettingsPage() {
  const supabase = await createSupabaseServerClient();
  const { data: connections } = await supabase
    .from("connected_accounts")
    .select(
      "id, provider, account_email, account_label, account_avatar_url, company_id, scopes, last_synced_at, last_sync_status, last_sync_error, expires_at, created_at"
    )
    .order("created_at", { ascending: true });

  const { data: companies } = await supabase
    .from("companies")
    .select("id, name, color_hex")
    .order("name");

  return (
    <>
      <TopBar title="Connections" subtitle="Multi-org access for every integration." />
      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-4xl px-6 py-8">
          <ConnectionsManager
            initialConnections={connections ?? []}
            companies={companies ?? []}
          />
        </div>
      </ScrollArea>
    </>
  );
}
