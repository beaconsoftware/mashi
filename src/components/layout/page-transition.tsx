"use client";

import { useRef } from "react";
import { usePathname } from "next/navigation";
import { useGSAP } from "@gsap/react";
import { gsap, EASE, DUR, withMotion } from "@/lib/animation";

/**
 * Animate page content on every route change so navigation feels lively
 * instead of flat-loading.
 *
 * Keyed on pathname: each time the URL changes, React re-mounts the inner
 * wrapper, which gives GSAP a fresh node to animate from scratch. The
 * status bar above and chat panel beside stay put — only the actual page
 * content gets the bouncy entry.
 *
 * Reduced-motion users get the plain render (handled by withMotion in the
 * shared animation utility).
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useGSAP(
    () => {
      if (!wrapRef.current) return;
      withMotion(() => {
        // PERF: animating opacity (or transform) on a parent that has
        // backdrop-filter descendants is a Chromium jank pattern — the
        // browser has to re-sample the ambient layer through every
        // blur on every frame because the cached composite is
        // invalidated. After the doctrine migration most pages now
        // contain multiple <ChromeBar> strips (each `backdrop-blur-sm`),
        // so the previous DUR.base (420ms) opacity tween dropped to
        // ~2fps on /sprint, /linear, /notes, /inbox, /calendar.
        //
        // Mitigations applied:
        //   1. Shorter duration — pain is over in ~180ms instead of 420.
        //   2. power3.out ease — settles cleanly, no overshoot beyond 1.
        //      back.out(1.4) prolonged the recompute window by ~80ms.
        //   3. translateY only (no opacity). Translate3d composites on
        //      the GPU without invalidating the backdrop-filter pass on
        //      siblings BELOW the moving content. Opacity invalidates
        //      every backdrop-filter descendant.
        //
        // If the route content briefly appears 6px below its final
        // resting position before clearProps fires, that's the
        // interruption case the previous comment warned about — but
        // useGSAP scopes the tween to wrapRef, and the new mount key
        // forces a fresh node so there's no in-flight tween to
        // collide with.
        gsap.fromTo(
          wrapRef.current,
          { y: 6 },
          {
            y: 0,
            duration: DUR.micro,
            ease: EASE.out,
            clearProps: "all",
          }
        );
      });
    },
    { dependencies: [pathname] }
  );

  return (
    <div
      ref={wrapRef}
      key={pathname}
      className="flex min-h-0 flex-1 flex-col"
      style={{ willChange: "transform" }}
    >
      {children}
    </div>
  );
}
