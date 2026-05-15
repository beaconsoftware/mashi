"use client";

import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import { ExternalLink } from "lucide-react";
import { gsap, withMotion } from "@/lib/animation";

/**
 * Step 4 — communication style. Visual: a faux audio waveform that
 * "listens" so the user reads it as voice/tone extraction. Skipping is
 * a first-class CTA (continueLabel in shell says "Skip for now").
 */
export function StyleStepHero() {
  const ref = useRef<HTMLDivElement | null>(null);

  useGSAP(
    () => {
      if (!ref.current) return;
      const bars = ref.current.querySelectorAll("[data-bar]");
      withMotion(() => {
        bars.forEach((b, i) => {
          gsap.to(b, {
            scaleY: 0.3 + Math.random() * 0.9,
            duration: 0.6 + Math.random() * 0.6,
            ease: "sine.inOut",
            yoyo: true,
            repeat: -1,
            delay: i * 0.04,
            transformOrigin: "50% 50%",
          });
        });
      });
    },
    { scope: ref }
  );

  return (
    <div className="space-y-4 rounded-xl border border-border/40 bg-card/40 p-5">
      <div ref={ref} className="flex h-24 items-center justify-center gap-1">
        {Array.from({ length: 36 }).map((_, i) => (
          <span
            key={i}
            data-bar
            className="block w-1 rounded-full bg-primary/80"
            style={{ height: 12 + (i % 5) * 12 }}
          />
        ))}
      </div>
      <div className="text-center">
        <p className="text-base font-medium">Sound like you, not like ChatGPT.</p>
        <p className="mt-1 text-[12px] text-muted-foreground">
          Paste 5 sent emails and Mashi extracts your voice. Or skip — neutral tone is fine to start.
        </p>
      </div>
      <div className="flex justify-center">
        <a
          href="/settings/style"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-[12px] hover:bg-accent"
        >
          Open Style editor
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
}
