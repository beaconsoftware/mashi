"use client";

import { useRef, type MouseEvent as ReactMouseEvent } from "react";
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
 * Deck-card hover — the heavier "trading-card" reaction used on Sprint
 * Bench / Done cards (and any other surface where the card itself should
 * feel like a tangible object the user can pick up).
 *
 * Effects layered on hover:
 *   - Lift (translate Y up) + scale, like useMagneticHover but bigger
 *   - Colored glow halo via box-shadow, no CSS-var interpolation (see warning)
 *   - Cursor-tracking parallax tilt (rotateX/rotateY based on pointer
 *     position relative to the card center), capped to ±tiltMax degrees.
 *     Hold-still feels solid; sweep feels physical.
 *   - One-shot sheen sweep across the card on enter. The card MUST contain
 *     a child with [data-sheen]; the parent must be overflow-hidden so
 *     the sheen clips at the edges.
 *
 * Usage:
 *
 *   const { ref, onEnter, onMove, onLeave } = useDeckCardHover({
 *     shadow: "0 18px 44px -12px ..., 0 0 0 1px ...",
 *     lift: 8,
 *   });
 *   <div ref={ref} onMouseEnter={onEnter} onMouseMove={onMove} onMouseLeave={onLeave}>
 *     <span data-sheen className="..." />
 *     ...
 *   </div>
 *
 * If the ref needs to be composed with other refs (DnD draggable +
 * droppable, etc.), keep using the returned `ref` here — assign it to
 * your composedRef callback alongside the others.
 *
 * Heavier than useMagneticHover and uses 3D transforms, so reserve it
 * for cards the user is meant to interact with as a focal element.
 */
export function useDeckCardHover<T extends HTMLElement = HTMLDivElement>(opts?: {
  shadow?: string;
  lift?: number;
  scale?: number;
  tiltMax?: number;
  tilt?: boolean;
}) {
  const ref = useRef<T | null>(null);
  const lift = opts?.lift ?? 8;
  const scale = opts?.scale ?? 1.04;
  const tiltMax = opts?.tiltMax ?? 7;
  const tilt = opts?.tilt ?? true;
  const shadow =
    opts?.shadow ??
    "0 18px 44px -12px hsl(var(--primary) / 0.55), 0 0 0 1px hsl(var(--primary) / 0.4)";

  function onEnter() {
    if (!ref.current) return;
    withMotion(() => {
      const el = ref.current!;
      el.style.transition = "box-shadow 0.28s ease-out";
      el.style.boxShadow = shadow;
      gsap.to(el, {
        y: -lift,
        scale,
        duration: 0.28,
        ease: "power3.out",
      });
      // Sheen sweep — subtle pass across, dialed down so the lift +
      // glow + tilt do the heavy lifting and the sheen is just a hint
      // of "this surface has a finish". Kill prior tweens so a rapid
      // hover doesn't queue multiple sweeps.
      const sheen = el.querySelector("[data-sheen]");
      if (sheen) {
        gsap.killTweensOf(sheen);
        gsap.fromTo(
          sheen,
          { xPercent: -110, opacity: 0.6 },
          { xPercent: 110, opacity: 0, duration: 0.55, ease: "power2.out" }
        );
      }
    });
  }

  function onMove(e: ReactMouseEvent) {
    if (!ref.current || !tilt) return;
    const rect = ref.current.getBoundingClientRect();
    const cx = (e.clientX - rect.left) / rect.width - 0.5; // -0.5 .. 0.5
    const cy = (e.clientY - rect.top) / rect.height - 0.5;
    withMotion(() => {
      gsap.to(ref.current, {
        rotationY: cx * tiltMax * 2,
        rotationX: -cy * tiltMax * 2,
        transformPerspective: 700,
        transformOrigin: "center center",
        duration: 0.18,
        ease: "power2.out",
        // overwrite: false keeps the y/scale tween from onEnter alive
        overwrite: false,
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
        rotationX: 0,
        rotationY: 0,
        duration: 0.34,
        ease: "power3.out",
      });
    });
  }

  return { ref, onEnter, onMove, onLeave };
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
