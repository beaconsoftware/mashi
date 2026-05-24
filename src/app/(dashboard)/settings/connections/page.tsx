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
    <div className="mx-auto max-w-4xl">
      <ConnectionsManager
        initialConnections={connections ?? []}
        companies={companies ?? []}
      />
    </div>
  );
}
