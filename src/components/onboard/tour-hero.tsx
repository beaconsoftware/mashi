"use client";

import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import { Sparkles, Zap, MessageCircle, KanbanSquare } from "lucide-react";
import { Aurora } from "@/components/onboard/aurora";
import { gsap, withMotion } from "@/lib/animation";

/**
 * Step 6 — tour. Visual: a mini-cockpit that builds itself tile-by-tile,
 * stagger-revealing each of the four key surfaces (Cockpit, S2D, Sprint,
 * Mashi summon). No prose marathon — each tile has 4–6 words.
 */
export function TourHero() {
  const ref = useRef<HTMLDivElement | null>(null);

  useGSAP(
    () => {
      if (!ref.current) return;
      const tiles = ref.current.querySelectorAll("[data-tile]");
      withMotion(() => {
        gsap.fromTo(
          tiles,
          { scale: 0.6, opacity: 0, y: 12 },
          {
            scale: 1,
            opacity: 1,
            y: 0,
            duration: 0.45,
            stagger: 0.14,
            ease: "back.out(2)",
          }
        );
      });
    },
    { scope: ref }
  );

  const tiles = [
    {
      icon: <Sparkles className="h-4 w-4" />,
      label: "Cockpit",
      hint: "Your one home base",
      color: "hsl(var(--primary))",
    },
    {
      icon: <KanbanSquare className="h-4 w-4" />,
      label: "S2D board",
      hint: "Drag, click, draft, done",
      color: "hsl(280 80% 65%)",
    },
    {
      icon: <Zap className="h-4 w-4" />,
      label: "Sprint",
      hint: "3 things in 60 minutes",
      color: "hsl(45 90% 55%)",
    },
    {
      icon: <MessageCircle className="h-4 w-4" />,
      label: "Mashi · ⌘ /",
      hint: "Bottom-right, anytime",
      color: "hsl(180 80% 60%)",
    },
  ];

  return (
    <div ref={ref} className="relative isolate overflow-hidden rounded-xl border border-border/40 bg-card/40 px-6 py-8">
      <Aurora />
      <div className="relative grid grid-cols-2 gap-3">
        {tiles.map((t) => (
          <div
            key={t.label}
            data-tile
            className="flex items-center gap-3 rounded-lg border border-border/40 bg-card/95 p-3 backdrop-blur"
            style={{ boxShadow: `0 0 22px -10px ${t.color}, inset 0 0 0 1px ${t.color}30` }}
          >
            <div
              className="flex h-9 w-9 items-center justify-center rounded-md"
              style={{ backgroundColor: `${t.color}20`, color: t.color }}
            >
              {t.icon}
            </div>
            <div className="min-w-0">
              <div className="text-[12px] font-semibold">{t.label}</div>
              <div className="text-[10px] text-muted-foreground">{t.hint}</div>
            </div>
          </div>
        ))}
      </div>
      <p className="relative mt-4 text-center text-[12px] text-muted-foreground">
        You&apos;re set. Hit the button — Mashi&apos;s waiting.
      </p>
    </div>
  );
}
