"use client";

// translucency-audit-ok: file — legacy callsites, migrate to sanctioned scale (/15, /40, /55, /60, /80, /95) case-by-case during component touch-ups.

import { forwardRef, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
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

/**
 * Strip-bar at the top of a card, column, or list section. Sized for
 * section headers (NOT full-width page chrome — use <ChromeBar> for
 * that). Bakes in:
 *
 *   - bg-background/55 + backdrop-blur-sm: opaque enough that the
 *     section title stays legible against the ambient album-art /
 *     blurred background layers, but still feels like a translucent
 *     surface and lets a hint of color through.
 *   - border-b border-border/40: matches the rest of the layout.
 *   - px-3 py-2 text-[11px] uppercase tracking-wider: tightens the
 *     visual cadence across columns / cards.
 *
 * Use for column headers (S2D, review, kanban), card section dividers,
 * any "this is a labeled region" strip that sits inside a Surface or
 * Column.
 *
 * Why this exists: column headers used to render `bg-primary/10` or
 * `bg-secondary/10` over the ambient layer and disappeared against
 * yellow / bright album art. Promoting every section header to this
 * primitive guarantees a legible chrome strip.
 */
export function SectionHeader({
  className,
  children,
  as: As = "div",
  tone = "neutral",
  ...rest
}: React.HTMLAttributes<HTMLElement> & {
  as?: "div" | "header" | "section";
  /** Default neutral. `accent` adds a primary tint for "Review" / AI columns. */
  tone?: "neutral" | "accent";
}) {
  const Component = As as React.ElementType;
  return (
    <Component
      className={cn(
        "relative flex items-center gap-2 border-b px-3 py-2 text-[11px] uppercase tracking-wider",
        "bg-background/55 backdrop-blur-sm",
        tone === "accent"
          ? "border-primary/40 text-primary"
          : "border-border/40 text-foreground/80",
        className
      )}
      {...rest}
    >
      {children}
    </Component>
  );
}

/**
 * Opaque card base. The default container for any rectangular surface
 * that needs to read as "a card" against the ambient ground (album art,
 * tinted gradient, etc).
 *
 * Use this instead of hand-rolling `bg-card border border-border/40
 * rounded-xl` so every card in the app shares one footprint.
 */
export const Surface = forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    /** Optional shadow tier. Default is none — cards mostly sit flat. */
    shadow?: "none" | "sm" | "md";
  }
>(function Surface({ className, children, shadow = "none", ...rest }, ref) {
  return (
    <div
      ref={ref}
      className={cn(
        "rounded-xl border border-border/40 bg-card",
        shadow === "sm" && "shadow-sm",
        shadow === "md" && "shadow-md",
        className
      )}
      {...rest}
    >
      {children}
    </div>
  );
});

/**
 * Nav-icon trigger. The canonical Mashi feel for any icon-only button
 * that sits in a navigation context — sidebar, top-bar quick actions,
 * floating widget triggers, the sync-status chip.
 *
 * Composes on top of the shadcn `<Button variant="ghost" size="icon">`
 * (which already gives focus ring, press feedback, and a subtle
 * rotate-on-hover for the child svg from `buttonVariants`) and adds the
 * canonical amber halo via `.mashi-icon-glow`. The result is the same
 * "soft warmth on hover" the sidebar nav has, available for free
 * anywhere you'd previously hand-roll a rotate+glow icon button.
 *
 * Use this instead of stacking `mashi-icon-hover + mashi-icon-glow`
 * yourself — that combo is for cases where Button doesn't fit (e.g.
 * a raw <a> tag wrapping an icon). For ordinary icon-only buttons,
 * just reach for <NavIcon>.
 *
 * Tones:
 *   - subtle  (default) — muted foreground, accent hover. Sidebar feel.
 *   - primary           — primary-tinted text. Used for "this action is
 *                         affirmative" affordances (e.g. the chat
 *                         summon pill).
 */
export const NavIcon = forwardRef<
  HTMLButtonElement,
  Omit<React.ComponentProps<typeof Button>, "size" | "variant"> & {
    /** Visual variant. `primary` adds a primary tint; `subtle` is the
     *  default for sidebar / chrome triggers. */
    tone?: "subtle" | "primary";
  }
>(function NavIcon({ className, tone = "subtle", children, ...rest }, ref) {
  return (
    <Button
      ref={ref}
      variant="ghost"
      size="icon"
      className={cn(
        "mashi-icon-glow",
        tone === "primary" && "text-primary hover:bg-primary/10 hover:text-primary",
        className
      )}
      {...rest}
    >
      {children}
    </Button>
  );
});

/**
 * Empty-state placeholder. Sparkle icon, headline, optional subtitle and
 * action button. Wraps in a backdrop-blurred card so it stays legible
 * against the ambient layer (previously, "no items yet" copy floated
 * unreadably over album art on /sprint idle).
 */
export function EmptyState({
  title,
  subtitle,
  action,
  icon,
  className,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  /** Defaults to a Sparkles glyph. Pass your own to vary per surface. */
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 text-center",
        // The backdrop card keeps copy legible over ambient art. Steps
        // chosen to match the sanctioned opacity scale (60/40) so the
        // translucency audit stays clean.
        "rounded-2xl border border-border/40 bg-background/60 px-6 py-8 backdrop-blur-sm",
        className
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-primary">
        {icon ?? <Sparkles className="h-5 w-5" />}
      </div>
      <div className="space-y-1">
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        {subtitle && (
          <p className="max-w-md text-sm text-muted-foreground">{subtitle}</p>
        )}
      </div>
      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}
