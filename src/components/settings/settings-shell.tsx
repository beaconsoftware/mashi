"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plug, Eye, Mic, KeyRound, Activity, ShieldCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { TopBar } from "@/components/layout/top-bar";
import { Surface } from "@/components/layout/primitives";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";

/**
 * Settings shell — consolidates the five formerly-standalone settings
 * pages (Connections, Activity Monitor, Style, API Tokens, Usage) into
 * one route at /settings with a left sub-nav + content panel.
 *
 * The TopBar shows "Settings" as the title and the active sub-section's
 * label as the subtitle, so the chrome remains consistent with the rest
 * of the app even though we're rendering several distinct child pages
 * underneath a single layout.
 */

interface SectionConfig {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
  /** Optional badge rendered next to the label (e.g. BETA). */
  badge?: string;
}

const SECTIONS: SectionConfig[] = [
  {
    href: "/settings/connections",
    label: "Connections",
    description: "Integrations and multi-org access.",
    icon: Plug,
  },
  {
    href: "/settings/activity",
    label: "Activity Monitor",
    description: "Passive-presence signals from cloud, browser, and Mac.",
    icon: Eye,
    badge: "BETA",
  },
  {
    href: "/settings/style",
    label: "Style",
    description: "Teach Mashi to write like you.",
    icon: Mic,
  },
  {
    href: "/settings/policies",
    label: "Approvals",
    description: "Which agent actions can skip the approval card.",
    icon: ShieldCheck,
  },
  {
    href: "/settings/api-tokens",
    label: "API Tokens",
    description: "Long-lived tokens for the DXT and other agents.",
    icon: KeyRound,
  },
  {
    href: "/settings/usage",
    label: "Usage",
    description: "AI calls and cost breakdown.",
    icon: Activity,
  },
];

function findActiveSection(pathname: string): SectionConfig {
  // Longest matching prefix wins so /settings/api-tokens beats /settings.
  const ordered = [...SECTIONS].sort((a, b) => b.href.length - a.href.length);
  return ordered.find((s) => pathname.startsWith(s.href)) ?? SECTIONS[0];
}

export function SettingsShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const active = findActiveSection(pathname);

  return (
    <>
      <TopBar
        title="Settings"
        subtitle={active.label}
        right={active.badge ? <Badge variant="primary">{active.badge}</Badge> : undefined}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-4 px-4 py-4 md:flex-row md:gap-6 md:px-6 md:py-6">
        {/* Mobile: collapse the sub-nav into a Select. shadcn Select keeps
            keyboard + ARIA semantics correct. */}
        <div className="md:hidden">
          <Select
            value={active.href}
            onValueChange={(value) => router.push(value)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Settings section" />
            </SelectTrigger>
            <SelectContent>
              {SECTIONS.map((section) => (
                <SelectItem key={section.href} value={section.href}>
                  <span className="flex items-center gap-2">
                    <section.icon className="h-3.5 w-3.5" />
                    {section.label}
                    {section.badge && (
                      <Badge variant="primary" className="ml-1">
                        {section.badge}
                      </Badge>
                    )}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Desktop sub-nav. */}
        <Surface
          className="hidden w-64 shrink-0 p-2 md:block"
          role="navigation"
          aria-label="Settings sections"
        >
          <ul className="flex flex-col gap-0.5">
            {SECTIONS.map((section) => {
              const Icon = section.icon;
              const isActive = active.href === section.href;
              return (
                <li key={section.href}>
                  <Link
                    href={section.href}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "group relative flex items-start gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                      "hover:bg-accent hover:text-foreground",
                      isActive
                        ? "bg-card/80 text-foreground"
                        : "text-muted-foreground"
                    )}
                  >
                    {isActive && (
                      <span
                        aria-hidden
                        className="absolute left-0 top-1.5 h-[calc(100%-12px)] w-[2px] rounded-r-full bg-primary"
                      />
                    )}
                    <Icon
                      className={cn(
                        "mt-0.5 h-4 w-4 shrink-0",
                        isActive && "text-primary"
                      )}
                    />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="flex items-center gap-1.5">
                        <span className="font-medium leading-none">
                          {section.label}
                        </span>
                        {section.badge && (
                          <Badge variant="primary">{section.badge}</Badge>
                        )}
                      </span>
                      <span className="text-[11px] leading-snug text-muted-foreground">
                        {section.description}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Surface>

        {/* Content panel. */}
        <Surface className="min-h-0 flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="px-6 py-6">{children}</div>
          </ScrollArea>
        </Surface>
      </div>
    </>
  );
}

/**
 * Helper for external callers — re-exported so the page header logic
 * (and tests) share the same source of truth.
 */
export { SECTIONS as SETTINGS_SECTIONS };
