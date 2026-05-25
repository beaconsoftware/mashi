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
 * Expand-on-hover overlay sidebar.
 *
 * Layout slot is a fixed 56px (w-14). The actual chrome lives in an
 * absolutely-positioned child that widens to 224px (w-56) on group-hover,
 * floating over whatever is to its right WITHOUT reflowing the board.
 *
 * Why this shape:
 *   - `position: absolute` keeps the flex layout 56px wide always, so the
 *     board doesn't shift when the sidebar expands.
 *   - `transition-[width]` (not `transition-all`) scopes the animation;
 *     icon color hovers don't pick up the 200ms ease.
 *   - Labels fade in with a small delay so the eye sees width animate
 *     first, then text resolve — feels less stretchy than co-tweening.
 *   - z-sidebar (110) ALWAYS above focus overlays per AGENTS.md.
 *   - bg-background is fully opaque — no backdrop-filter, no containing-
 *     block trap for any fixed-positioned children (e.g. portaled
 *     overlays from elsewhere).
 *
 * Tooltips were removed because the expanded labels make them redundant.
 * The aside's `aria-label` plus the icon's enclosed text span still keep
 * screen readers happy.
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
          "absolute inset-y-0 left-0 flex h-full w-14 flex-col items-stretch border-r border-border/40 bg-background px-2 py-3",
          "overflow-hidden transition-[width] duration-200 ease-out",
          "group-hover:w-56"
        )}
      >
        {/* Logo + wordmark. bg-primary scopes to the brandmark chip only,
            so the "Mashi" wordmark sits on the sidebar's own background
            rather than disappearing into a primary-color slab. */}
        <Link
          href="/"
          className="mb-3 flex h-9 items-center gap-2 rounded-md text-foreground"
          aria-label="Mashi home"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <MashiMark size={20} />
          </span>
          <span className="whitespace-nowrap text-sm font-semibold opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-hover:delay-100">
            Mashi
          </span>
        </Link>

        <div className="my-1 mx-auto h-px w-7 bg-border/40 transition-all duration-200 group-hover:mx-0 group-hover:w-full" />

        <nav className="flex flex-1 flex-col gap-1 pt-2">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "group/item relative flex h-9 items-center gap-3 rounded-md px-1.5 text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground",
                  active && "bg-accent text-foreground"
                )}
              >
                {active && (
                  <span
                    aria-hidden
                    className="absolute -left-2 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary shadow-[0_0_10px_hsl(var(--primary)/0.7)]"
                  />
                )}
                {/* Icon shell — relative so the glow halo can sit inside
                    and stay scoped to the icon, not stretch across the
                    full expanded pill. Active state pre-tints the halo. */}
                <span className="relative isolate flex h-7 w-7 shrink-0 items-center justify-center">
                  <span
                    aria-hidden
                    className={cn(
                      "pointer-events-none absolute inset-0 -z-10 rounded-md blur-md transition-colors duration-300",
                      active
                        ? "bg-primary/15 group-hover/item:bg-primary/30"
                        : "bg-primary/0 group-hover/item:bg-primary/25"
                    )}
                  />
                  <Icon className="h-4 w-4 transition-transform duration-200 group-hover/item:rotate-[8deg] group-hover/item:scale-110" />
                </span>
                <span className="flex-1 whitespace-nowrap text-sm opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-hover:delay-75">
                  {item.label}
                </span>
                <span className="whitespace-nowrap font-mono text-[10px] text-muted-foreground/70 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-hover:delay-75">
                  {item.shortcut}
                </span>
              </Link>
            );
          })}
        </nav>

        <div className="mb-1 flex flex-col gap-1">
          <Link
            href="/settings"
            className={cn(
              "group/item relative flex h-9 items-center gap-3 rounded-md px-1.5 text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground",
              pathname.startsWith("/settings") && "bg-accent text-foreground"
            )}
          >
            <span className="relative isolate flex h-7 w-7 shrink-0 items-center justify-center">
              <span
                aria-hidden
                className={cn(
                  "pointer-events-none absolute inset-0 -z-10 rounded-md blur-md transition-colors duration-300",
                  pathname.startsWith("/settings")
                    ? "bg-primary/15 group-hover/item:bg-primary/30"
                    : "bg-primary/0 group-hover/item:bg-primary/25"
                )}
              />
              <Settings className="h-4 w-4 transition-transform duration-200 group-hover/item:rotate-[8deg] group-hover/item:scale-110" />
            </span>
            <span className="whitespace-nowrap text-sm opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-hover:delay-75">
              Settings
            </span>
          </Link>
          <form action="/auth/sign-out" method="POST" className="w-full">
            <Button
              type="submit"
              variant="ghost"
              className="flex h-9 w-full items-center justify-start gap-3 rounded-md px-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="Sign out"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary text-[11px] font-medium">
                S
              </span>
              <span className="whitespace-nowrap text-sm opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-hover:delay-75">
                Sign out
              </span>
            </Button>
          </form>
        </div>
      </div>
    </aside>
  );
}
