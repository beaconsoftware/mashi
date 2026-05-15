"use client";

import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import { gsap, withMotion } from "@/lib/animation";

/**
 * Magnetic hover: a small lift + glow halo behind an element. Designed to
 * be applied to clickable cards (cockpit tiles, S2D cards, calendar rows)
 * so every selectable surface in the app feels responsive without us
 * having to think about it per-component.
 *
 * Usage:
 *
 *   const { ref, onEnter, onLeave } = useMagneticHover();
 *   <div ref={ref} onMouseEnter={onEnter} onMouseLeave={onLeave} />
 *
 * The element must be position: relative for the halo to sit behind it.
 * Pass `intensity: "strong"` for tiles, default for rows.
 *
 * IMPORTANT: gsap cannot interpolate boxShadow values that contain CSS
 * custom properties (e.g. `hsl(var(--primary))`) — it tries to parse
 * channels and chokes ("a is null"). So we apply boxShadow imperatively
 * via gsap.set (no interpolation), and only animate transform-based
 * properties through gsap.to.
 */
export function useMagneticHover<T extends HTMLElement = HTMLDivElement>(opts?: {
  intensity?: "soft" | "strong";
  lift?: number;
}) {
  const ref = useRef<T | null>(null);
  const strong = opts?.intensity === "strong";
  const lift = opts?.lift ?? (strong ? 3 : 2);
  const shadow = strong
    ? "0 12px 40px -12px hsl(var(--primary) / 0.55), 0 0 0 1px hsl(var(--primary) / 0.3)"
    : "0 6px 20px -8px hsl(var(--primary) / 0.45)";

  function onEnter() {
    if (!ref.current) return;
    withMotion(() => {
      // Set shadow instantly (no interpolation); transform animates smoothly.
      ref.current!.style.transition = "box-shadow 0.22s ease-out";
      ref.current!.style.boxShadow = shadow;
      gsap.to(ref.current, {
        y: -lift,
        scale: strong ? 1.01 : 1.015,
        duration: 0.22,
        ease: "power3.out",
      });
    });
  }
  function onLeave() {
    if (!ref.current) return;
    withMotion(() => {
      ref.current!.style.boxShadow = "";
      gsap.to(ref.current, {
        y: 0,
        scale: 1,
        duration: 0.3,
        ease: "power3.out",
      });
    });
  }

  return { ref, onEnter, onLeave };
}

/**
 * Selection burst: when a row/card transitions to selected, fire a one-shot
 * ring expansion. Caller passes the "selected" boolean as the dependency so
 * the burst plays on the transition, not every render.
 *
 * The element should render a `<span data-select-burst />` child positioned
 * absolutely so the tween has something to scale.
 */
export function useSelectBurst(selected: boolean) {
  const ref = useRef<HTMLDivElement | null>(null);
  useGSAP(
    () => {
      if (!selected || !ref.current) return;
      const burst = ref.current.querySelector("[data-select-burst]");
      if (!burst) return;
      withMotion(() => {
        gsap.fromTo(
          burst,
          { scale: 0.7, opacity: 0.8 },
          { scale: 1.4, opacity: 0, duration: 0.55, ease: "power2.out" }
        );
      });
    },
    { scope: ref, dependencies: [selected] }
  );
  return ref;
}
