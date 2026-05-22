"use client";

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
  Mic,
  Plug,
  Activity,
  KeyRound,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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

export function Sidebar() {
  const pathname = usePathname();

  return (
    <TooltipProvider delayDuration={200}>
      <aside className="relative z-[110] flex h-full w-14 shrink-0 flex-col items-center border-r border-border/40 bg-background py-3">
        {/* Logo */}
        <Link
          href="/"
          className="mb-3 flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground"
          aria-label="Mashi home"
        >
          <MashiMark size={20} />
        </Link>

        <div className="my-1 h-px w-7 bg-border/40" />

        <nav className="flex flex-1 flex-col items-center gap-1 pt-2">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            return (
              <Tooltip key={item.href}>
                <TooltipTrigger asChild>
                  <Link
                    href={item.href}
                    className={cn(
                      "group relative flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-all duration-200 hover:bg-accent hover:text-foreground hover:scale-110 active:scale-95",
                      active && "bg-accent text-foreground"
                    )}
                  >
                    {active && (
                      <>
                        <span
                          aria-hidden
                          className="absolute -left-3 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary shadow-[0_0_10px_hsl(var(--primary)/0.7)]"
                        />
                        <span
                          aria-hidden
                          className="pointer-events-none absolute inset-0 -z-10 rounded-md bg-primary/15 blur-md"
                        />
                      </>
                    )}
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-0 -z-10 rounded-md bg-primary/0 blur-md transition-all duration-300 group-hover:bg-primary/25"
                    />
                    <Icon className="h-4 w-4 transition-transform duration-200 group-hover:rotate-[8deg] group-hover:scale-110" />
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right" className="flex items-center gap-2">
                  <span>{item.label}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">{item.shortcut}</span>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </nav>

        <div className="mb-1 flex flex-col items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                href="/settings/connections"
                className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <Plug className="h-4 w-4" />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">Connections</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                href="/settings/style"
                className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <Mic className="h-4 w-4" />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right" className="flex items-center gap-2">
              <span>Communication style</span>
              <span className="font-mono text-[10px] text-muted-foreground">tone</span>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                href="/settings/usage"
                className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <Activity className="h-4 w-4" />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right" className="flex items-center gap-2">
              <span>Usage</span>
              <span className="font-mono text-[10px] text-muted-foreground">$</span>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                href="/settings/api-tokens"
                className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <KeyRound className="h-4 w-4" />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">API Tokens</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <form action="/auth/sign-out" method="POST">
                <button
                  type="submit"
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-secondary text-[11px] font-medium hover:bg-accent"
                  aria-label="Sign out"
                >
                  S
                </button>
              </form>
            </TooltipTrigger>
            <TooltipContent side="right">Sign out</TooltipContent>
          </Tooltip>
        </div>
      </aside>
    </TooltipProvider>
  );
}
