"use client";

// translucency-audit-ok: file — legacy callsites, migrate to sanctioned scale (/15, /40, /55, /60, /80, /95) case-by-case during component touch-ups.

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Mail,
  Loader2,
  AlertTriangle,
  X,
  Plus,
  RefreshCw,
  ChevronDown,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Inline Gmail sender allowlist picker.
 *
 * Sits below a Gmail connection row in the connections manager. Shows
 * the manual list (add/remove chips) plus the auto-list (read-only,
 * with a Refresh button that forces re-scan on the next sync).
 *
 * Why two lists?
 *   - MANUAL: exact emails the user explicitly added. Strong signal.
 *     Persists until they remove it.
 *   - AUTO: addresses the user has sent mail to in the last 90 days.
 *     Refreshed every 24h on the sync worker. Captures the "we
 *     correspond with these people" set without manual upkeep.
 *
 * Both lists drive an extra `in:inbox category:updates from:…` query
 * during sync so transactional mail Gmail buckets into Updates (Ramp's
 * "Submit missing items", etc.) doesn't get missed.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface AllowlistResponse {
  manual: string[];
  auto: string[];
  auto_cached_at: string | null;
}

interface Props {
  connectionId: string;
  // Total summary count gets surfaced in the parent row's collapsed view.
  // Calling onCountsChange lets the parent re-render its summary chip.
  onCountsChange?: (counts: { manual: number; auto: number }) => void;
}

function shortAge(iso: string | null): string {
  if (!iso) return "never refreshed";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "scheduled";
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

export function GmailAllowlistPicker({ connectionId, onCountsChange }: Props) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const key = ["gmail-allowlist", connectionId];

  const { data, isLoading, isError } = useQuery<AllowlistResponse>({
    queryKey: key,
    queryFn: async () => {
      const res = await fetch(`/api/connections/${connectionId}/gmail-allowlist`);
      if (!res.ok) {
        throw new Error(`failed to load allowlist (${res.status})`);
      }
      const json = (await res.json()) as AllowlistResponse;
      onCountsChange?.({ manual: json.manual.length, auto: json.auto.length });
      return json;
    },
  });

  const updateMut = useMutation({
    mutationFn: async (body: {
      add?: string[];
      remove?: string[];
      force_refresh?: boolean;
    }) => {
      const res = await fetch(
        `/api/connections/${connectionId}/gmail-allowlist`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `update failed (${res.status})`);
      }
      return (await res.json()) as { manual: string[] };
    },
    onSuccess: (resp) => {
      qc.setQueryData<AllowlistResponse>(key, (prev) =>
        prev ? { ...prev, manual: resp.manual } : prev
      );
      const auto = qc.getQueryData<AllowlistResponse>(key)?.auto ?? [];
      onCountsChange?.({ manual: resp.manual.length, auto: auto.length });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "Update failed");
    },
  });

  function add() {
    const v = draft.trim().toLowerCase();
    if (!EMAIL_RE.test(v)) {
      setError("Enter a valid email address");
      return;
    }
    if (data?.manual.includes(v)) {
      setError("Already in the list");
      return;
    }
    setError(null);
    setDraft("");
    updateMut.mutate({ add: [v] });
  }

  function remove(entry: string) {
    setError(null);
    updateMut.mutate({ remove: [entry] });
  }

  function forceRefresh() {
    setError(null);
    updateMut.mutate({ force_refresh: true });
  }

  return (
    <div className="space-y-3 border-t border-border/40 bg-card/40 px-3 py-3 text-[12px]">
      <div className="flex items-start gap-2">
        <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <div className="flex-1 space-y-0.5">
          <div className="font-medium text-foreground">
            Sender allowlist (Updates tab)
          </div>
          <p className="text-[11px] text-muted-foreground">
            Mashi normally skips Gmail&apos;s Updates tab to cut newsletter
            noise. Senders below are pulled in anyway — useful for
            transactional mail like Ramp&apos;s &quot;Submit missing items&quot;
            that Gmail occasionally buckets into Updates.
          </p>
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading…
        </div>
      )}
      {isError && (
        <div className="flex items-start gap-2 rounded border border-destructive/30 bg-destructive/10 p-2 text-destructive">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          Couldn&apos;t load the allowlist.
        </div>
      )}

      {data && (
        <>
          <div className="space-y-1.5">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Manual ({data.manual.length})
            </div>
            <div className="flex flex-wrap gap-1">
              {data.manual.length === 0 && (
                <span className="text-[11px] italic text-muted-foreground/70">
                  Nothing added yet.
                </span>
              )}
              {data.manual.map((entry) => (
                <Badge
                  key={entry}
                  variant="default"
                  className="gap-1 pl-2 pr-1 font-mono text-[10px]"
                >
                  {entry}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => remove(entry)}
                    disabled={updateMut.isPending}
                    aria-label={`Remove ${entry}`}
                    className="mashi-icon-glow h-3.5 w-3.5 text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-2.5 w-2.5" />
                  </Button>
                </Badge>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    add();
                  }
                }}
                placeholder="communications@ramp.com"
                disabled={updateMut.isPending}
                className="h-7 flex-1 font-mono text-[11px]"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={add}
                disabled={updateMut.isPending || draft.trim().length === 0}
                className="h-7 gap-1 px-2 text-[11px]"
              >
                <Plus className="h-3 w-3" /> Add
              </Button>
            </div>
            {error && (
              <div className="text-[10px] text-destructive">{error}</div>
            )}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Auto ({data.auto.length})
              </div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={forceRefresh}
                disabled={updateMut.isPending}
                className="h-6 gap-1 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
                title="Force a re-scan of recent sent mail on the next sync"
              >
                <RefreshCw
                  className={cn(
                    "h-3 w-3",
                    updateMut.isPending && "animate-spin"
                  )}
                />
                Refresh
              </Button>
            </div>
            <div className="flex flex-wrap gap-1">
              {data.auto.length === 0 && (
                <span className="text-[11px] italic text-muted-foreground/70">
                  Auto-list populates on next sync.
                </span>
              )}
              {data.auto.slice(0, 50).map((entry) => (
                <Badge
                  key={entry}
                  variant="outline"
                  className="font-mono text-[10px] text-muted-foreground"
                >
                  {entry}
                </Badge>
              ))}
              {data.auto.length > 50 && (
                <span className="text-[10px] text-muted-foreground">
                  + {data.auto.length - 50} more
                </span>
              )}
            </div>
            <div className="text-[10px] text-muted-foreground">
              Last auto-refresh: {shortAge(data.auto_cached_at)}. Updates
              from these senders will be included in the next sync.
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Compact toggle that toggles the inline picker open/closed and shows
 * a summary count when collapsed. Mirrors the visual weight of the
 * Slack "Channels" button so the row stays readable.
 */
export function GmailAllowlistToggle({
  open,
  manualCount,
  autoCount,
  onClick,
}: {
  open: boolean;
  manualCount: number;
  autoCount: number;
  onClick: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      className="h-6 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground"
      title="Senders allowed through from the Gmail Updates tab"
    >
      <Mail className="h-3 w-3" />
      Updates allowlist
      {(manualCount > 0 || autoCount > 0) && (
        <span className="font-mono text-[10px] text-muted-foreground/80">
          {manualCount}+{autoCount}
        </span>
      )}
      <ChevronDown
        className={cn("h-3 w-3 transition-transform", open && "rotate-180")}
      />
    </Button>
  );
}
