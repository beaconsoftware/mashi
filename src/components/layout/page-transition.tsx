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
        // Opacity-only fade. We deliberately removed the y/scale transforms
        // here: they were applied to a flex container that holds the page's
        // TopBar + scrollable content, and the transient transform could
        // leave the top of the page visually offset if the tween was ever
        // interrupted before clearProps ran. Opacity fade is safe regardless.
        gsap.fromTo(
          wrapRef.current,
          { opacity: 0 },
          {
            opacity: 1,
            duration: DUR.base,
            ease: EASE.back,
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
    >
      {children}
    </div>
  );
}
