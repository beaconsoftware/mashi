"use client";

import { gsap } from "gsap";

/**
 * Shared animation primitives for Mashi.
 *
 * Design goals:
 *   - Snappy, not flashy. ~200-450ms durations. No "look at me" wow shots.
 *   - Consistent easing across the app so motion feels like one product.
 *   - Respect prefers-reduced-motion — skip animations entirely for users
 *     who've opted out.
 *
 * Use `useGSAP` from "@gsap/react" inside components — it auto-cleans on
 * unmount. The helpers here are tween presets you call from inside the
 * hook's callback.
 */

export const EASE = {
  /** General-purpose ease for entry / drift motion. Power3 out is a soft, fast-then-decel curve. */
  out: "power3.out",
  /** Snappier for small icon / button reactions. */
  outQuick: "power2.out",
  /** Bouncy elastic for hero moments (sprint launch, sprint complete). */
  elastic: "elastic.out(1, 0.6)",
  /** Inertial back-out for sheet / panel entries. */
  back: "back.out(1.4)",
} as const;

export const DUR = {
  micro: 0.18,
  short: 0.28,
  base: 0.42,
  hero: 0.7,
} as const;

/**
 * Respect OS-level reduced-motion preference. Wrap any "fancy" tween in
 * `withMotion(() => gsap.from(...))` so it's a no-op for users who've
 * opted out of motion (vestibular safety + general user respect).
 */
export function withMotion(fn: () => void) {
  if (typeof window === "undefined") return;
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (mq.matches) return;
  fn();
}

/**
 * Stagger-entry preset: fade up from 12px below with a soft cascade.
 * Pass the parent ref's children selector or a NodeList.
 */
export function staggerEntry(
  target: gsap.TweenTarget,
  opts?: { stagger?: number; duration?: number; y?: number; delay?: number }
) {
  withMotion(() => {
    gsap.from(target, {
      opacity: 0,
      y: opts?.y ?? 12,
      duration: opts?.duration ?? DUR.base,
      stagger: opts?.stagger ?? 0.04,
      ease: EASE.out,
      delay: opts?.delay ?? 0,
      clearProps: "all",
    });
  });
}

/**
 * Hero entry: scale-and-fade-in from slightly small. Use sparingly — sprint
 * mode takeover, sprint-complete screen.
 */
export function heroEntry(target: gsap.TweenTarget) {
  withMotion(() => {
    gsap.from(target, {
      opacity: 0,
      scale: 0.94,
      duration: DUR.hero,
      ease: EASE.back,
      clearProps: "all",
    });
  });
}

/**
 * Pulse a target on a loop. Used for the sprint timer when overrunning
 * planned time — visual urgency without being annoying.
 */
export function pulse(target: gsap.TweenTarget): gsap.core.Tween {
  return gsap.to(target, {
    scale: 1.04,
    duration: 0.6,
    repeat: -1,
    yoyo: true,
    ease: "sine.inOut",
  });
}

/**
 * Slide-down entry for top banners (sync status bar, toast).
 */
export function slideDown(target: gsap.TweenTarget) {
  withMotion(() => {
    gsap.from(target, {
      y: "-100%",
      opacity: 0,
      duration: DUR.short,
      ease: EASE.out,
      clearProps: "all",
    });
  });
}

/**
 * Slide-up entry for floating bottom widgets (sprint widget).
 */
export function slideUp(target: gsap.TweenTarget) {
  withMotion(() => {
    gsap.from(target, {
      y: 24,
      opacity: 0,
      duration: DUR.short,
      ease: EASE.back,
      clearProps: "all",
    });
  });
}

/**
 * Tween a numeric value smoothly. Useful for counters (sprint totals,
 * usage costs, sync results). Returns the tween so callers can kill it.
 */
export function tweenNumber(
  from: number,
  to: number,
  onUpdate: (n: number) => void,
  duration = DUR.base
): gsap.core.Tween {
  const obj = { v: from };
  return gsap.to(obj, {
    v: to,
    duration,
    ease: EASE.out,
    onUpdate: () => onUpdate(Math.round(obj.v)),
  });
}

export { gsap };
