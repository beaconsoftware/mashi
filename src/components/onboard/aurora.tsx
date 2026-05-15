"use client";

import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import { gsap, withMotion } from "@/lib/animation";
import { cn } from "@/lib/utils";

/**
 * Animated aurora backdrop: two radial gradient blobs that slow-drift
 * across the canvas + a subtle floor of moving dots. Designed to sit
 * behind onboarding hero content as the "AI is alive" vibe.
 *
 * Self-contained: respects prefers-reduced-motion via withMotion. The
 * fallback is just the static gradient, which is still pretty.
 */
export function Aurora({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useGSAP(
    () => {
      if (!ref.current) return;
      withMotion(() => {
        const blobs = ref.current!.querySelectorAll("[data-aurora-blob]");
        blobs.forEach((b, i) => {
          gsap.to(b, {
            x: i % 2 === 0 ? "+=80" : "-=80",
            y: i % 2 === 0 ? "-=40" : "+=40",
            duration: 8 + i * 2,
            ease: "sine.inOut",
            yoyo: true,
            repeat: -1,
          });
        });
      });
    },
    { scope: ref }
  );

  return (
    <div
      ref={ref}
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}
    >
      <div
        data-aurora-blob
        className="absolute -left-20 top-0 h-[340px] w-[340px] rounded-full opacity-60"
        style={{
          background:
            "radial-gradient(closest-side, hsl(var(--primary) / 0.5), transparent 70%)",
          filter: "blur(50px)",
        }}
      />
      <div
        data-aurora-blob
        className="absolute -right-10 bottom-0 h-[280px] w-[280px] rounded-full opacity-50"
        style={{
          background:
            "radial-gradient(closest-side, hsl(280 80% 60% / 0.45), transparent 70%)",
          filter: "blur(50px)",
        }}
      />
      <div
        data-aurora-blob
        className="absolute left-1/3 top-1/3 h-[200px] w-[200px] rounded-full opacity-40"
        style={{
          background:
            "radial-gradient(closest-side, hsl(180 80% 55% / 0.4), transparent 70%)",
          filter: "blur(40px)",
        }}
      />
    </div>
  );
}
