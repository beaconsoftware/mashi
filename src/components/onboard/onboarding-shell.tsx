"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useGSAP } from "@gsap/react";
import { Loader2, ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ONBOARDING_STEPS, TOTAL_STEPS } from "@/lib/onboarding/steps";
import { gsap, withMotion, EASE, DUR } from "@/lib/animation";
import { cn } from "@/lib/utils";

interface Props {
  currentStep: number;
  children: React.ReactNode;
  canAdvance?: boolean;
  continueLabel?: string;
  beforeAdvance?: () => Promise<void> | void;
}

/**
 * Cinematic onboarding chrome. Cross-fades + lifts the content slot on
 * step entry, glows the active progress segment, pulses the CTA when
 * canAdvance flips true. Per-step children get a clean stage to do their
 * own GSAP-driven hero animations on top of.
 */
export function OnboardingShell({
  currentStep,
  children,
  canAdvance = true,
  continueLabel,
  beforeAdvance,
}: Props) {
  const router = useRouter();
  const [advancing, setAdvancing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const ctaRef = useRef<HTMLButtonElement | null>(null);

  const meta = ONBOARDING_STEPS.find((s) => s.n === currentStep);
  const isLast = currentStep >= TOTAL_STEPS;

  // Stage entry: fade + slight rise, every time the step changes.
  useGSAP(
    () => {
      if (!stageRef.current) return;
      withMotion(() => {
        gsap.fromTo(
          stageRef.current,
          { opacity: 0, y: 14 },
          { opacity: 1, y: 0, duration: DUR.base, ease: EASE.out }
        );
      });
    },
    { dependencies: [currentStep] }
  );

  // CTA pulse the moment the user can move on. Uses scale (which gsap
  // handles via transform — no color parsing) so we sidestep gsap's
  // inability to interpolate CSS-var-based hsl() values in boxShadow.
  // The glow itself is a static tailwind shadow + we punch a quick
  // scale tween for the "ready" feel.
  useGSAP(
    () => {
      if (!canAdvance || !ctaRef.current) return;
      withMotion(() => {
        gsap.fromTo(
          ctaRef.current,
          { scale: 0.92 },
          {
            scale: 1,
            duration: 0.45,
            ease: "back.out(2.4)",
          }
        );
      });
    },
    { dependencies: [canAdvance] }
  );

  if (!meta) return null;

  async function advance() {
    setAdvancing(true);
    setErr(null);
    try {
      if (beforeAdvance) await beforeAdvance();

      // Defensive: validate currentStep is sane. Previously a NaN or 0
      // would silently navigate to /onboard/welcome via the `?? "welcome"`
      // fallback, which was reported as "pressing Enter sends you back
      // to the beginning of onboarding."
      const safeStep = Number(currentStep);
      if (!Number.isInteger(safeStep) || safeStep < 1 || safeStep > TOTAL_STEPS) {
        throw new Error(`Onboarding got an invalid step (${currentStep}). Refresh and try again.`);
      }

      const nextN = Math.min(TOTAL_STEPS, safeStep + 1);
      const res = await fetch("/api/onboard/step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: nextN }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        console.warn("[onboard] step advance returned non-ok:", j);
      }
      if (isLast) {
        router.push("/");
      } else {
        const next = ONBOARDING_STEPS.find((s) => s.n === nextN);
        if (!next) {
          throw new Error(`No onboarding step for n=${nextN}`);
        }
        router.push(`/onboard/${next.slug}`);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't advance");
      setAdvancing(false);
    }
  }

  return (
    <div className="space-y-6">
      <ProgressDots current={currentStep} />

      <div ref={stageRef} className="space-y-5">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {String(currentStep).padStart(2, "0")} / {String(TOTAL_STEPS).padStart(2, "0")}
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">{meta.title}</h1>
        </div>

        {children}

        {err && (
          <div className="rounded border border-destructive/30 bg-destructive/10 p-2 text-[12px] text-destructive">
            {err}
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button
          ref={ctaRef}
          type="button"
          onClick={advance}
          disabled={advancing || !canAdvance}
          className={cn(
            "gap-1.5 transition-shadow",
            canAdvance &&
              "shadow-[0_0_28px_-4px_hsl(var(--primary)/0.6)] hover:shadow-[0_0_36px_-2px_hsl(var(--primary)/0.85)]"
          )}
        >
          {advancing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : isLast ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <ArrowRight className="h-3.5 w-3.5" />
          )}
          {advancing ? "" : continueLabel ?? (isLast ? "Enter the cockpit" : "Continue")}
        </Button>
      </div>
    </div>
  );
}

function ProgressDots({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-1.5">
      {ONBOARDING_STEPS.map((s) => {
        const done = s.n < current;
        const active = s.n === current;
        return (
          <div
            key={s.n}
            className={cn(
              "h-1 flex-1 rounded-full transition-all duration-500",
              done && "bg-primary",
              active && "bg-primary shadow-[0_0_12px_hsl(var(--primary)/0.8)]",
              !done && !active && "bg-border/40"
            )}
            title={s.title}
          />
        );
      })}
    </div>
  );
}
