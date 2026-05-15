import { OnboardingShell } from "@/components/onboard/onboarding-shell";
import { StyleStepHero } from "@/components/onboard/style-step-hero";

export default function StyleStepPage() {
  return (
    <OnboardingShell currentStep={4} continueLabel="Skip for now">
      <StyleStepHero />
    </OnboardingShell>
  );
}
