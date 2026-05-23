"use client";

import { usePathname } from "next/navigation";

/**
 * Page transition wrapper. Currently a no-op pass-through.
 *
 * History: this used to do a GSAP opacity-fade (then a translateY slide)
 * on every route change. After the doctrine migration most dashboard
 * pages contain multiple <ChromeBar> strips (each `backdrop-blur-sm`).
 * Animating ANY property on a parent of `backdrop-filter` descendants
 * is a canonical Chromium jank pattern — the cached composite is
 * invalidated every frame, the browser re-samples the ambient layer
 * through every blur 60×/sec, and the animation drops to ~2-10fps on
 * /sprint, /linear, /notes, /inbox, /calendar. Both opacity and
 * transform tweens hit this. CSS-vs-GSAP doesn't matter; the cost
 * is in the filter recompute, not the JS scheduling.
 *
 * Pragmatic choice: render snap. An instant page is faster-feeling
 * than a choppy fade. If we ever want the entry animation back, the
 * structural fix is to animate ONLY a child element that has no
 * backdrop-filter siblings — not the wrapper.
 *
 * The `usePathname` hook stays so this component remains a clean
 * extension point if we later add a route-aware transition (e.g.
 * different motion per route, or skip-on-backdrop-heavy routes).
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // Key forces a fresh mount per route so any internal "enter"
  // animations baked into individual page components (planner hero
  // entry, etc.) re-trigger reliably. The wrapper itself does no work.
  return (
    <div key={pathname} className="flex min-h-0 flex-1 flex-col">
      {children}
    </div>
  );
}
