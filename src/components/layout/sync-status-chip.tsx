"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2, RefreshCw, AlertTriangle, Zap } from "lucide-react";
import { useSyncStore } from "@/store/sync-store";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface ConnRow {
  id: string;
  provider: "linear" | "gmail" | "slack" | "fireflies" | "gcal" | "outlook" | "mscal";
  account_label: string | null;
  last_synced_at: string | null;
  last_sync_status: string | null;
}

/**
 * Small status chip that lives in TopBar next to the notification hub.
 * One-click sync trigger plus an honest tooltip about the current
 * delivery model (poll-based today, webhooks coming).
 *
 * Shows three states:
 *   - idle:   "Synced 4m ago" + refresh icon (click to sync now)
 *   - syncing: spinner + "Syncing…"
 *   - error:  amber warning if any account is in error/needs_reauth state
 */
export function SyncStatusChip() {
  const isSyncing = useSyncStore((s) => s.isSyncing);
  const runSyncAll = useSyncStore((s) => s.runSyncAll);

  const { data: connections = [] } = useQuery({
    queryKey: ["sync-chip-connections"],
    queryFn: async (): Promise<ConnRow[]> => {
      const sb = createSupabaseBrowserClient();
      const { data } = await sb
        .from("connected_accounts")
        .select("id, provider, account_label, last_synced_at, last_sync_status");
      return (data ?? []) as ConnRow[];
    },
    refetchInterval: 30_000,
  });

  const mostRecent = connections
    .map((c) => c.last_synced_at)
    .filter((t): t is string => !!t)
    .sort((a, b) => b.localeCompare(a))[0];

  const hasError = connections.some(
    (c) => c.last_sync_status === "error" || c.last_sync_status === "needs_reauth"
  );

  async function syncNow() {
    if (isSyncing) return;
    await runSyncAll(
      connections.map((c) => ({
        id: c.id,
        provider: c.provider,
        account_label: c.account_label ?? c.provider,
      }))
    );
  }

  const label = isSyncing
    ? "Syncing…"
    : mostRecent
    ? `Synced ${relative(mostRecent)}`
    : "Never synced";

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={syncNow}
            disabled={isSyncing || connections.length === 0}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-md border bg-card px-2 text-[11px] transition-colors hover:bg-accent disabled:opacity-60",
              hasError
                ? "border-amber-500/40 text-amber-600 dark:text-amber-400"
                : "border-border/40 text-muted-foreground hover:text-foreground"
            )}
          >
            {isSyncing ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : hasError ? (
              <AlertTriangle className="h-3 w-3" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            <span>{label}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="end" className="max-w-xs space-y-1.5 p-2.5">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold">
            <Zap className="h-3 w-3 text-primary" />
            Sync delivery
          </div>
          <p className="text-[11px] text-muted-foreground">
            Mashi currently polls your connected sources every few minutes.
            Click to force a fresh pull across all of them.
          </p>
          <p className="text-[11px] text-muted-foreground">
            Real-time webhook delivery is on the roadmap — once it lands,
            new emails/messages will trigger triage within seconds.
          </p>
          {hasError && (
            <div className="rounded border border-amber-500/30 bg-amber-500/10 p-1.5 text-[11px]">
              One or more connections need attention. Open Settings → Connections.
            </div>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * Compact relative-time formatter: "4m ago", "2h ago", "3d ago".
 * Avoids pulling date-fns just for one chip.
 */
function relative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}
