import { OnboardingShell } from "@/components/onboard/onboarding-shell";
import { TourHero } from "@/components/onboard/tour-hero";

export default function TourStepPage() {
  return (
    <OnboardingShell currentStep={6} continueLabel="Enter the cockpit">
      <TourHero />
    </OnboardingShell>
  );
}
