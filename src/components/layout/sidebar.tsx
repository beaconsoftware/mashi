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
 * Every clickable row is a full-width Link split into two columns:
 *   - a fixed 56px ICON COLUMN on the left (matches collapsed sidebar
 *     width). A 36x36 tile centered inside it carries every piece of
 *     highlight chrome — bg-accent on hover, the soft primary halo,
 *     the active state, the scale animation.
 *   - a label + shortcut area to the right, invisible until the
 *     sidebar expands.
 *
 * The Link's full width extends the click target into the label column
 * but no chrome paints there. Net effect: collapsed sidebar is visually
 * identical to the pre-expansion design (36x36 square highlights, soft
 * primary glow), and hovering the sidebar slides labels in without
 * disturbing any icon-tile chrome.
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
          "absolute inset-y-0 left-0 flex h-full w-14 flex-col items-stretch border-r border-border/40 bg-background py-3",
          "overflow-hidden transition-[width] duration-200 ease-out",
          "group-hover:w-56"
        )}
      >
        <Link
          href="/"
          aria-label="Mashi home"
          className="group/item mb-3 flex h-9 w-full items-center"
        >
          <div className="flex h-9 w-14 shrink-0 items-center justify-center">
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <MashiMark size={20} />
            </span>
          </div>
          <span className="whitespace-nowrap text-sm font-semibold text-foreground opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-hover:delay-100">
            Mashi
          </span>
        </Link>

        <div className="my-1 mx-auto h-px w-7 bg-border/40" />

        <nav className="flex flex-1 flex-col pt-2">
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
                icon={
                  <Icon className="h-4 w-4 transition-transform duration-200 group-hover/item:rotate-[8deg] group-hover/item:scale-110" />
                }
                active={active}
              />
            );
          })}
        </nav>

        <div className="mb-1 flex flex-col">
          <NavRow
            href="/settings"
            label="Settings"
            shortcut=""
            icon={
              <Settings className="h-4 w-4 transition-transform duration-200 group-hover/item:rotate-[8deg] group-hover/item:scale-110" />
            }
            active={pathname.startsWith("/settings")}
          />
          <form action="/auth/sign-out" method="POST" className="w-full">
            <button
              type="submit"
              aria-label="Sign out"
              className="group/item flex h-9 w-full items-center"
            >
              <div className="flex h-9 w-14 shrink-0 items-center justify-center">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-secondary text-[11px] font-medium text-foreground transition-transform duration-200 group-hover/item:scale-110 group-active/item:scale-95">
                  S
                </span>
              </div>
              <span className="whitespace-nowrap text-left text-sm text-muted-foreground opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-hover:delay-75">
                Sign out
              </span>
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}

/**
 * One nav row. Link spans the whole sidebar width so the click target
 * extends into the label column, but only the 36x36 icon tile shows
 * highlight chrome. The tile has `relative isolate` so the -z-10 halos
 * resolve within the tile's own stacking context and aren't hidden by
 * the sidebar's bg-background.
 */
function NavRow({
  href,
  label,
  shortcut,
  icon,
  active,
}: {
  href: string;
  label: string;
  shortcut: string;
  icon: React.ReactNode;
  active: boolean;
}) {
  return (
    <Link href={href} className="group/item flex h-9 w-full items-center">
      <div className="relative flex h-9 w-14 shrink-0 items-center justify-center">
        {active && (
          <span
            aria-hidden
            className="absolute -left-1 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary shadow-[0_0_10px_hsl(var(--primary)/0.7)]"
          />
        )}
        <span
          className={cn(
            "relative isolate flex h-9 w-9 items-center justify-center rounded-md transition-transform duration-200",
            "text-muted-foreground group-hover/item:bg-accent group-hover/item:text-foreground group-hover/item:scale-110 group-active/item:scale-95",
            active && "bg-accent text-foreground"
          )}
        >
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
          {icon}
        </span>
      </div>
      <span className="flex-1 whitespace-nowrap text-sm text-muted-foreground opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-hover:delay-75">
        {label}
      </span>
      {shortcut && (
        <span className="whitespace-nowrap pr-3 font-mono text-[10px] text-muted-foreground/70 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-hover:delay-75">
          {shortcut}
        </span>
      )}
    </Link>
  );
}
