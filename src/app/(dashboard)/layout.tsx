import { AppShell } from "@/components/layout/app-shell";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { StyleProfileHydrator } from "@/components/auth/style-profile-hydrator";
import { AutoReconcile } from "@/components/auto-reconcile";
import { PageTransition } from "@/components/layout/page-transition";
import { TOTAL_STEPS } from "@/lib/onboarding/steps";
import type { StyleProfile } from "@/types/style";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/sign-in");
  }

  // Pull style profile + onboarding state in one round-trip.
  // Anyone not finished with onboarding is bounced to /onboard.
  //
  // Fallback: if the onboarding columns don't exist yet (migration 012
  // not applied), treat the user as already onboarded so they aren't
  // trapped in the wizard with broken writes. We re-query with just the
  // style column in that case.
  const { data: profileRow, error: profileErr } = await supabase
    .from("user_profile")
    .select("communication_style, onboarding_step, onboarded_at")
    .eq("user_id", user.id)
    .maybeSingle();

  const migrationPending =
    !!profileErr && /could not find|does not exist/i.test(profileErr.message);

  if (!migrationPending) {
    const step = profileRow?.onboarding_step ?? 0;
    if (step < TOTAL_STEPS && !profileRow?.onboarded_at) {
      redirect("/onboard");
    }
  }

  let initialStyleProfile: StyleProfile | null =
    (profileRow?.communication_style as StyleProfile | null) ?? null;
  if (migrationPending) {
    const { data: legacy } = await supabase
      .from("user_profile")
      .select("communication_style")
      .maybeSingle();
    initialStyleProfile = (legacy?.communication_style as StyleProfile | null) ?? null;
  }

  return (
    <AppShell>
      <StyleProfileHydrator initial={initialStyleProfile} />
      <AutoReconcile />
      <PageTransition>{children}</PageTransition>
    </AppShell>
  );
}
