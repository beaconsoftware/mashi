import { AppShell } from "@/components/layout/app-shell";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { StyleProfileHydrator } from "@/components/auth/style-profile-hydrator";
import { AutoReconcile } from "@/components/auto-reconcile";
import { PageTransition } from "@/components/layout/page-transition";
import type { StyleProfile } from "@/types/style";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  // Onboarding redirect lives in middleware.ts so it can whitelist routes
  // the wizard deep-links to (settings/connections, companies). Here we
  // just hydrate the style profile.
  const { data: profileRow } = await supabase
    .from("user_profile")
    .select("communication_style")
    .eq("user_id", user.id)
    .maybeSingle();

  const initialStyleProfile: StyleProfile | null =
    (profileRow?.communication_style as StyleProfile | null) ?? null;

  return (
    <AppShell>
      <StyleProfileHydrator initial={initialStyleProfile} />
      <AutoReconcile />
      <PageTransition>{children}</PageTransition>
    </AppShell>
  );
}
