"use client";

import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import { Inbox, Filter, Zap } from "lucide-react";
import { Aurora } from "@/components/onboard/aurora";
import { MashiMark } from "@/components/shared/mashi-mark";
import { gsap, withMotion } from "@/lib/animation";

/**
 * Welcome step hero: a central glowing core surrounded by three orbiting
 * capability beads — PULL / TRIAGE / ACT. Zero prose. The motion does
 * the talking.
 *
 * Each bead enters with a staggered scale-in, then drifts on its own
 * sine loop. The center core pulses gently. On mount the whole thing
 * does a single dramatic open.
 */
export function WelcomeHero() {
  const ref = useRef<HTMLDivElement | null>(null);

  useGSAP(
    () => {
      if (!ref.current) return;
      withMotion(() => {
        const beads = ref.current!.querySelectorAll("[data-bead]");
        const core = ref.current!.querySelector("[data-core]");
        const ring = ref.current!.querySelector("[data-ring]");
        const tag = ref.current!.querySelector("[data-tag]");

        const tl = gsap.timeline();
        tl.fromTo(
          core,
          { scale: 0.4, opacity: 0 },
          { scale: 1, opacity: 1, duration: 0.6, ease: "back.out(2)" }
        )
          .fromTo(
            ring,
            { scale: 0.4, opacity: 0 },
            { scale: 1, opacity: 1, duration: 0.5, ease: "power3.out" },
            "<0.1"
          )
          .fromTo(
            beads,
            { scale: 0, opacity: 0 },
            {
              scale: 1,
              opacity: 1,
              duration: 0.55,
              stagger: 0.12,
              ease: "back.out(2.2)",
            },
            "<0.05"
          )
          .fromTo(
            tag,
            { opacity: 0, y: 8 },
            { opacity: 1, y: 0, duration: 0.4, ease: "power2.out" },
            "<0.2"
          );

        // Core pulses forever
        gsap.to(core, {
          scale: 1.06,
          duration: 1.8,
          ease: "sine.inOut",
          repeat: -1,
          yoyo: true,
        });

        // Ring slow-rotates
        gsap.to(ring, {
          rotation: 360,
          duration: 40,
          repeat: -1,
          ease: "none",
          transformOrigin: "50% 50%",
        });

        // Beads drift on individual sine loops
        beads.forEach((b, i) => {
          gsap.to(b, {
            y: i % 2 === 0 ? "-=6" : "+=6",
            duration: 2.4 + i * 0.3,
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
    <div ref={ref} className="relative isolate overflow-hidden rounded-xl border border-border/40 bg-card/40 px-6 py-12">
      <Aurora />

      {/* Stage */}
      <div className="relative mx-auto flex h-[280px] w-full max-w-md items-center justify-center">
        {/* Orbital ring */}
        <div
          data-ring
          className="absolute h-[260px] w-[260px] rounded-full border border-primary/20"
          style={{
            background:
              "conic-gradient(from 0deg, hsl(var(--primary) / 0.15), transparent 30%, hsl(280 80% 60% / 0.15), transparent 60%, hsl(180 80% 55% / 0.15), transparent 90%)",
          }}
        />

        {/* Core */}
        <div
          data-core
          className="relative flex h-20 w-20 items-center justify-center rounded-full bg-primary text-primary-foreground"
          style={{ boxShadow: "0 0 60px hsl(var(--primary) / 0.65)" }}
        >
          <MashiMark size={40} />
        </div>

        {/* Beads */}
        <Bead
          icon={<Inbox className="h-4 w-4" />}
          label="Pull"
          className="absolute -left-2 top-6"
          accent="hsl(var(--primary))"
        />
        <Bead
          icon={<Filter className="h-4 w-4" />}
          label="Triage"
          className="absolute -right-2 top-6"
          accent="hsl(280 80% 65%)"
        />
        <Bead
          icon={<Zap className="h-4 w-4" />}
          label="Act"
          className="absolute bottom-6 left-1/2 -translate-x-1/2"
          accent="hsl(180 80% 60%)"
        />
      </div>

      {/* Tagline */}
      <div data-tag className="relative mt-2 text-center">
        <p className="text-base font-medium tracking-tight">
          One board. Every source. Your voice.
        </p>
        <p className="mt-1 text-[12px] text-muted-foreground">
          Mashi is a chief of staff for product leads.
        </p>
      </div>
    </div>
  );
}

function Bead({
  icon,
  label,
  className,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  className?: string;
  accent: string;
}) {
  return (
    <div
      data-bead
      className={"flex flex-col items-center gap-1 " + (className ?? "")}
    >
      <div
        className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-card/95 backdrop-blur"
        style={{
          boxShadow: `0 0 22px -2px ${accent}, inset 0 0 0 1px ${accent}40`,
          color: accent,
        }}
      >
        {icon}
      </div>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-foreground/80">
        {label}
      </span>
    </div>
  );
}
