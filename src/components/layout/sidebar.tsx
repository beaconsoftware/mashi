"use client";

// translucency-audit-ok: file — legacy callsites, migrate to sanctioned scale (/15, /40, /55, /60, /80, /95) case-by-case during component touch-ups.

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  KanbanSquare,
  Inbox,
  Calendar,
  StickyNote,
  GitBranch,
  Building2,
  Search,
  Settings,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { MashiMark } from "@/components/shared/mashi-mark";

const NAV = [
  { href: "/", label: "Home", icon: Home, shortcut: "⌘ 0" },
  { href: "/s2d", label: "S2D Board", icon: KanbanSquare, shortcut: "⌘ 1" },
  { href: "/sprint", label: "Sprint", icon: Zap, shortcut: "⌘ S" },
  { href: "/inbox", label: "Inbox", icon: Inbox, shortcut: "⌘ 2" },
  { href: "/calendar", label: "Calendar", icon: Calendar, shortcut: "⌘ 3" },
  { href: "/notes", label: "Notes", icon: StickyNote, shortcut: "⌘ 4" },
  { href: "/linear", label: "Linear", icon: GitBranch, shortcut: "⌘ 5" },
  { href: "/companies", label: "Companies", icon: Building2, shortcut: "⌘ 6" },
  { href: "/search", label: "Search", icon: Search, shortcut: "⌘ K" },
];

/**
 * Expand-on-hover sidebar — strictly additive over the pre-expansion design.
 *
 * Constraints, in priority order:
 *   1. Collapsed state is PIXEL-IDENTICAL to the pre-expansion sidebar.
 *      Same 36x36 tile, same hover scale-110, same hover bg-accent, same
 *      soft primary halo, same active rail at -left-3, same /15 active
 *      halo, same icon position (center x=28 inside a 56px aside).
 *   2. On sidebar hover the aside widens 56 -> 224 and labels + shortcuts
 *      slide in next to each icon.
 *   3. The hover/active highlight pill EXTENDS to cover icon + label when
 *      expanded — one pill per row, not just the 36x36 tile.
 *   4. No tooltips.
 *
 * Geometry that preserves the collapsed visual:
 *   - Inner overlay uses `px-2.5` (10px each side). Collapsed content
 *     area = 36px, expanded = 204px. The Link's left edge sits at x=10
 *     from the aside in BOTH states (matches the original centered link
 *     at link.x = (56-36)/2 = 10).
 *   - Each Link is `w-9 group-hover:w-full overflow-hidden`. The
 *     bg-accent fills the Link: 36x36 collapsed, full-row pill expanded.
 *     The label is clipped at w-9 and revealed during the width grow.
 *   - Active rail sits in a wrapper OUTSIDE the Link so overflow-hidden
 *     can't clip it. `-left-3 of wrapper` (wrapper.x = 10) lands at
 *     x = -2 from the aside — exactly where the original painted.
 *   - Icon shell (`h-9 w-9 shrink-0`) is at link.x + 0. Icon center at
 *     x = 28 in BOTH states.
 *   - `hover:scale-110 active:scale-95` sits on the Link so bg-accent
 *     pops in collapsed state. Suppressed via `group-hover:hover:scale-100`
 *     in expanded state so the wider pill doesn't warp.
 *
 * z-sidebar (110) keeps everything above focus overlays per AGENTS.md.
 * bg-background is fully opaque (no backdrop-filter, no containing-block
 * trap for fixed-positioned children portaled in from elsewhere).
 */
export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside
      aria-label="Primary navigation"
      className="group relative z-sidebar h-full w-14 shrink-0"
    >
      <div
        className={cn(
          "absolute inset-y-0 left-0 flex h-full w-14 flex-col items-stretch border-r border-border/40 bg-background py-3 px-2.5",
          "transition-[width] duration-200 ease-out",
          "group-hover:w-56"
        )}
      >
        {/* Logo: brandmark chip stays scoped to its own 36x36 with
            bg-primary so the wordmark sits on the sidebar bg, not on
            a primary slab. */}
        <Link
          href="/"
          aria-label="Mashi home"
          className="mb-3 flex h-9 w-9 items-center overflow-hidden rounded-md transition-[width] duration-200 group-hover:w-full"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <MashiMark size={20} />
          </span>
          <span className="ml-2 whitespace-nowrap text-sm font-semibold text-foreground opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-hover:delay-100">
            Mashi
          </span>
        </Link>

        <div className="my-1 mx-auto h-px w-7 bg-border/40" />

        <nav className="flex flex-1 flex-col gap-1 pt-2">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            return (
              <NavRow
                key={item.href}
                href={item.href}
                label={item.label}
                shortcut={item.shortcut}
                active={active}
                renderIcon={(className) => <Icon className={className} />}
              />
            );
          })}
        </nav>

        <div className="mb-1 flex flex-col gap-1">
          <NavRow
            href="/settings"
            label="Settings"
            shortcut=""
            active={pathname.startsWith("/settings")}
            renderIcon={(className) => <Settings className={className} />}
          />
          <form action="/auth/sign-out" method="POST" className="w-full">
            <Button
              type="submit"
              variant="ghost"
              aria-label="Sign out"
              className={cn(
                "group/item flex h-9 w-9 items-center overflow-hidden rounded-md px-0 py-0 text-muted-foreground transition-[width,transform] duration-200 justify-start",
                "hover:bg-accent hover:text-foreground hover:scale-110 active:scale-95",
                "group-hover:w-full group-hover:hover:scale-100"
              )}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-secondary text-[11px] font-medium text-foreground">
                  S
                </span>
              </span>
              <span className="ml-2 whitespace-nowrap text-sm opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-hover:delay-75">
                Sign out
              </span>
            </Button>
          </form>
        </div>
      </div>
    </aside>
  );
}

/**
 * One nav row.
 *
 * The Link is the highlight pill — w-9 collapsed, w-full when the aside
 * (the outer `group`) is hovered. `overflow-hidden` clips the label when
 * collapsed and reveals it as the Link grows. bg-accent fills whatever
 * shape the Link currently has, so:
 *   - collapsed: 36x36 tile gets bg-accent on hover (matches original)
 *   - expanded: full-row pill gets bg-accent on hover (per spec)
 *
 * `hover:scale-110` matches the original collapsed-state pop. When the
 * aside is hovered we suppress that scale with `group-hover:hover:scale-100`
 * so the wider pill doesn't warp during expanded hover.
 *
 * Active rail lives in the wrapper OUTSIDE the Link so `overflow-hidden`
 * can't clip it. Halos live in the icon shell which has `relative isolate`
 * so the `-z-10` halos resolve inside their own stacking context (not
 * hidden behind the sidebar's bg-background paint).
 */
function NavRow({
  href,
  label,
  shortcut,
  active,
  renderIcon,
}: {
  href: string;
  label: string;
  shortcut: string;
  active: boolean;
  renderIcon: (className: string) => React.ReactNode;
}) {
  return (
    <div className="relative flex w-full items-center">
      {active && (
        <span
          aria-hidden
          className="pointer-events-none absolute -left-3 top-1/2 z-10 h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary shadow-[0_0_10px_hsl(var(--primary)/0.7)]"
        />
      )}
      <Link
        href={href}
        className={cn(
          "group/item flex h-9 w-9 items-center overflow-hidden rounded-md text-muted-foreground transition-[width,transform] duration-200",
          "hover:bg-accent hover:text-foreground hover:scale-110 active:scale-95",
          "group-hover:w-full group-hover:hover:scale-100",
          active && "bg-accent text-foreground"
        )}
      >
        <span className="relative isolate flex h-9 w-9 shrink-0 items-center justify-center">
          {active && (
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 -z-10 rounded-md bg-primary/15 blur-md"
            />
          )}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10 rounded-md bg-primary/0 blur-md transition-colors duration-300 group-hover/item:bg-primary/25"
          />
          {renderIcon(
            "h-4 w-4 transition-transform duration-200 group-hover/item:rotate-[8deg] group-hover/item:scale-110"
          )}
        </span>
        <span className="ml-2 flex-1 whitespace-nowrap text-sm opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-hover:delay-75">
          {label}
        </span>
        {shortcut && (
          <span className="whitespace-nowrap pr-1 font-mono text-[10px] text-muted-foreground/70 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-hover:delay-75">
            {shortcut}
          </span>
        )}
      </Link>
    </div>
  );
}
