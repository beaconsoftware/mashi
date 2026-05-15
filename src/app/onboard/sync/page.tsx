import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SyncStep } from "@/components/onboard/sync-step";

export const dynamic = "force-dynamic";

export default async function SyncStepPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from("user_profile")
    .select("onboarding_cleanup_ran_at")
    .eq("user_id", user?.id ?? "")
    .maybeSingle();
  return <SyncStep cleanupRanAt={profile?.onboarding_cleanup_ran_at ?? null} />;
}
