"use client";

import { gsap, DUR, EASE, withMotion } from "@/lib/animation";

/**
 * GSAP timeline factory used by re-pathway transitions and slot-exit
 * acknowledgements to morph the canvas in and out without an unmount
 * flash.
 *
 * `morphOut` fades the current canvas down + scales it slightly so the
 * caller can mutate state (e.g. PATCH the item's pathway) before the
 * new canvas appears. `morphIn` is the symmetric reverse — the new
 * canvas grows in on the same target element.
 *
 * Both helpers:
 *   - Skip when the user has `prefers-reduced-motion: reduce` and
 *     resolve the promise immediately so callers can `await` without
 *     branching.
 *   - Resolve when GSAP's onComplete fires; this is what enables the
 *     re-pathway flow to `await morphOut()` before mutating state.
 *
 * Targets are passed as `Element | null` so callers can hand over a
 * `ref.current` without null-guards.
 */
export function morphOut(target: Element | null): Promise<void> {
  if (!target) return Promise.resolve();
  if (prefersReducedMotion()) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let resolved = false;
    const done = () => {
      if (resolved) return;
      resolved = true;
      resolve();
    };
    withMotion(() => {
      gsap.to(target, {
        opacity: 0.4,
        scale: 0.97,
        duration: DUR.short,
        ease: EASE.outQuick,
        overwrite: "auto",
        onComplete: done,
      });
    });
    // Safety: if withMotion no-ops or GSAP never fires onComplete, the
    // caller shouldn't block the user forever. 600ms is enough for the
    // 280ms tween plus jitter.
    setTimeout(done, 600);
  });
}

export function morphIn(target: Element | null): Promise<void> {
  if (!target) return Promise.resolve();
  if (prefersReducedMotion()) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let resolved = false;
    const done = () => {
      if (resolved) return;
      resolved = true;
      resolve();
    };
    withMotion(() => {
      gsap.fromTo(
        target,
        { opacity: 0.4, scale: 0.97 },
        {
          opacity: 1,
          scale: 1,
          duration: DUR.base,
          ease: EASE.back,
          overwrite: "auto",
          clearProps: "transform",
          onComplete: done,
        }
      );
    });
    setTimeout(done, 800);
  });
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
