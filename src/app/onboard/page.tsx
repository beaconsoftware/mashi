import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { stepByNumber, ONBOARDING_STEPS, TOTAL_STEPS } from "@/lib/onboarding/steps";

export const dynamic = "force-dynamic";

/**
 * /onboard — routes the user to whichever step they're on.
 *
 * - step 0 → /onboard/welcome (Step 1)
 * - step N (1..6) → /onboard/<slug-of-step-N>
 * - step >= TOTAL_STEPS → "/" (they're done; dashboard guard will let them in)
 */
export default async function OnboardIndexPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/sign-in?redirect=/onboard");

  const { data: profile } = await supabase
    .from("user_profile")
    .select("onboarding_step")
    .eq("user_id", user.id)
    .maybeSingle();

  const stepN = Math.max(1, profile?.onboarding_step ?? 1);
  if (stepN > TOTAL_STEPS) redirect("/");

  const step = stepByNumber(stepN) ?? ONBOARDING_STEPS[0];
  redirect(`/onboard/${step.slug}`);
}
