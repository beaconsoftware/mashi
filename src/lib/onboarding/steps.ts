/**
 * Onboarding state machine.
 *
 * Steps are numbered 1..6 in user_profile.onboarding_step. Step 0 = not
 * started. Step 6 = completed (we also stamp onboarded_at on Step 6).
 *
 * The dashboard layout guard redirects anyone with step < 6 to /onboard.
 */

export const ONBOARDING_STEPS = [
  {
    n: 1,
    slug: "welcome",
    title: "Welcome",
    blurb: "What Mashi does, what it doesn't, and what to expect.",
  },
  {
    n: 2,
    slug: "connect",
    title: "Connect your tools",
    blurb: "Gmail, Slack, Linear, Fireflies, Calendar — connect what you use.",
  },
  {
    n: 3,
    slug: "portcos",
    title: "Pick your portfolio",
    blurb: "Confirm the companies you cover so Mashi can group items correctly.",
  },
  {
    n: 4,
    slug: "style",
    title: "Communication style",
    blurb: "Paste 5 sent emails so Mashi learns your voice for drafted replies.",
  },
  {
    n: 5,
    slug: "sync",
    title: "First sync",
    blurb: "Pull your data + close anything older than 30 days. One-time cleanup.",
  },
  {
    n: 6,
    slug: "tour",
    title: "Tour the cockpit",
    blurb: "60-second tour, then you're loose.",
  },
] as const;

export type OnboardingStep = typeof ONBOARDING_STEPS[number];

export function stepBySlug(slug: string): OnboardingStep | undefined {
  return ONBOARDING_STEPS.find((s) => s.slug === slug);
}

export function stepByNumber(n: number): OnboardingStep | undefined {
  return ONBOARDING_STEPS.find((s) => s.n === n);
}

export const TOTAL_STEPS = ONBOARDING_STEPS.length;
