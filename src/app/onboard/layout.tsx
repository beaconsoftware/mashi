import { createSupabaseServerClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { MashiMark } from "@/components/shared/mashi-mark";

export const dynamic = "force-dynamic";

/**
 * Onboarding chrome. No sidebar, no chat panel, no sprint widget —
 * minimal distractions. The dashboard layout has the inverse guard:
 * users with onboarding_step < TOTAL_STEPS are sent here.
 */
export default async function OnboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/sign-in?redirect=/onboard");

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b border-border/40 px-6 py-3">
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded bg-primary text-primary-foreground">
            <MashiMark size={16} />
          </div>
          <div className="text-sm font-semibold tracking-tight">Mashi onboarding</div>
        </div>
      </header>
      <main className="flex flex-1 items-start justify-center px-6 py-8">
        <div className="w-full max-w-3xl">{children}</div>
      </main>
    </div>
  );
}
