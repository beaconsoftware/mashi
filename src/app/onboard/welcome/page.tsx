import { OnboardingShell } from "@/components/onboard/onboarding-shell";
import { WelcomeHero } from "@/components/onboard/welcome-hero";

export default function WelcomePage() {
  return (
    <OnboardingShell currentStep={1} continueLabel="Let's go">
      <WelcomeHero />
    </OnboardingShell>
  );
}
