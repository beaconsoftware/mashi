"use client";

/**
 * Sticky top-of-dashboard banner that flags any sync connection in a
 * failing state. Dismiss is intentionally NOT supported — user said
 * "failing silently can be devastating", so this stays visible until
 * the underlying connection is fixed.
 *
 * Shown when ANY connected_accounts row has last_sync_status in
 * { 'error', 'needs_reauth' }. The banner names which providers are
 * affected and links to /settings/connections where the user can
 * reconnect each.
 *
 * Refetches every 30s alongside the sync chip so a reconnect immediately
 * clears the banner without a page reload.
 */

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

interface BadConn {
  id: string;
  provider: string;
  account_label: string | null;
  last_sync_status: string | null;
  last_sync_error: string | null;
}

const PROVIDER_LABEL: Record<string, string> = {
  gmail: "Gmail",
  gcal: "Google Calendar",
  slack: "Slack",
  fireflies: "Fireflies",
  linear: "Linear",
  outlook: "Outlook",
  mscal: "Microsoft Calendar",
};

export function ConnectionHealthAlert() {
  const { data: bad = [] } = useQuery({
    queryKey: ["connection-health"],
    queryFn: async (): Promise<BadConn[]> => {
      const sb = createSupabaseBrowserClient();
      const { data } = await sb
        .from("connected_accounts")
        .select("id, provider, account_label, last_sync_status, last_sync_error")
        .in("last_sync_status", ["error", "needs_reauth"]);
      return (data ?? []) as BadConn[];
    },
    refetchInterval: 30_000,
  });

  if (bad.length === 0) return null;

  // Group by provider for a cleaner message: "Gmail (2), Linear (1)" rather
  // than dumping every account label.
  const byProvider = bad.reduce<Record<string, BadConn[]>>((m, c) => {
    (m[c.provider] ??= []).push(c);
    return m;
  }, {});
  const providerSummary = Object.entries(byProvider)
    .map(([p, list]) => {
      const label = PROVIDER_LABEL[p] ?? p;
      return list.length === 1 ? label : `${label} (${list.length})`;
    })
    .join(", ");

  // Auth failures are the common case and have a clear fix; generic errors
  // just need attention.
  const needsReauth = bad.filter((c) => c.last_sync_status === "needs_reauth").length;
  const totalCount = bad.length;
  const message =
    needsReauth > 0
      ? needsReauth === totalCount
        ? `${totalCount} connection${totalCount === 1 ? "" : "s"} need${totalCount === 1 ? "s" : ""} to be reconnected — sync is paused for ${providerSummary}.`
        : `${totalCount} connection${totalCount === 1 ? "" : "s"} are failing (${needsReauth} need${needsReauth === 1 ? "s" : ""} reauth) — ${providerSummary}.`
      : `${totalCount} connection${totalCount === 1 ? "" : "s"} are failing to sync — ${providerSummary}.`;

  return (
    <div className="flex items-center gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-100">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span className="flex-1 truncate">
        <strong className="font-semibold">Sync paused.</strong> {message}{" "}
        <span className="text-amber-200/80">
          You may be missing tasks until reconnected.
        </span>
      </span>
      <Link
        href="/settings/connections"
        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-amber-400/40 bg-amber-500/15 px-2.5 py-1 text-[11px] font-semibold hover:bg-amber-500/25"
      >
        Fix now
        <ArrowRight className="h-3 w-3" />
      </Link>
    </div>
  );
}
