"use client";

import { forwardRef, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/**
 * Layout primitives — bake the doctrine into the JSX so future features
 * cannot drift. Reach for these BEFORE hand-rolling chrome / overlay /
 * background classes. See AGENTS.md "Layout doctrine".
 *
 *   <ChromeBar>      Translucent edge bar (TopBar, SprintBar, S2DFilters,
 *                    BoardToolbar). Bakes in bg-background/55,
 *                    backdrop-blur-sm, border-b, z-chrome, position
 *                    relative. The `relative + z-chrome` matters: any
 *                    surface with backdrop-blur creates a stacking
 *                    context, and an explicit z-index keeps a child
 *                    dropdown's z-50 from being clipped below page chrome
 *                    on adjacent rows.
 *   <AmbientGround>  Fixed inset-0 ground for ambient art / decorative
 *                    backgrounds. Bakes in z-ground + pointer-events-none
 *                    + GPU compositing hints so the expensive
 *                    backdrop-filter consumers (sprint focus overlay)
 *                    can sample it without forcing a repaint on every
 *                    route change. Must live INSIDE AppShell's wrapper
 *                    or backdrop-filter from translucent surfaces above
 *                    won't be able to sample it (see app-shell.tsx).
 *   <FocusOverlay>   Fullscreen takeover (sprint, future focus modes).
 *                    Portals to `#mashi-overlay-root` so per-page
 *                    renderers and the global SprintGlobalMount can't
 *                    double-mount the same overlay (the
 *                    SprintComplete-flash post-mortem).
 */

export function ChromeBar({
  className,
  children,
  as: As = "div",
  ...rest
}: React.HTMLAttributes<HTMLElement> & {
  as?: "div" | "header" | "section" | "nav";
}) {
  const Component = As as React.ElementType;
  return (
    <Component
      className={cn(
        "relative z-chrome border-b border-border/40 bg-background/55 backdrop-blur-sm",
        className
      )}
      {...rest}
    >
      {children}
    </Component>
  );
}

export const AmbientGround = forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(function AmbientGround({ className, children, style, ...rest }, ref) {
  return (
    <div
      ref={ref}
      aria-hidden
      className={cn(
        "pointer-events-none fixed inset-0 z-ground overflow-hidden",
        className
      )}
      style={{
        // Promote to its own compositor layer so the expensive
        // backdrop-blur + SVG filters that sample this layer don't
        // re-paint on every page navigation.
        willChange: "transform",
        transform: "translateZ(0)",
        contain: "layout paint",
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
});

/**
 * Fullscreen focus overlay. Portals into `#mashi-overlay-root` in
 * AppShell. Render this from a single owner only — if a per-page
 * renderer AND a global mount both render <FocusOverlay>, two copies
 * of the children mount and side-effects (POSTs, store mutations)
 * race. SprintGlobalMount is the single router that decides which
 * overlay (if any) is live on non-page routes.
 */
export function FocusOverlay({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const el = document.getElementById("mashi-overlay-root");
    setHost(el);
  }, []);

  if (!host) return null;

  return createPortal(
    <div
      className={cn(
        "fixed inset-0 z-focus flex flex-col bg-background/15 text-foreground backdrop-blur-sm",
        className
      )}
    >
      {children}
    </div>,
    host
  );
}

/**
 * Mount this once in AppShell. Anchor for FocusOverlay portals.
 * Positioned absolute-zero so the portal children's own `fixed inset-0`
 * resolves to the viewport, not this node.
 */
export function OverlayRoot() {
  return <div id="mashi-overlay-root" />;
}
