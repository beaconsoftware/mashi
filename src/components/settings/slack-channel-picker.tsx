"use client";

// translucency-audit-ok: file — legacy callsites, migrate to sanctioned scale (/15, /40, /55, /60, /80, /95) case-by-case during component touch-ups.

import { useEffect, useMemo, useState } from "react";
import {
  Hash,
  Lock,
  Loader2,
  Search,
  Check,
  AlertTriangle,
  X,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Per-connection Slack channel picker.
 *
 * Opens as a side Sheet. Lists the user's public + private channels with
 * checkboxes; monitored channels float to the top. Search filters by
 * channel name. Save sends a PUT to the channels endpoint.
 *
 * Important UX notes:
 *   - DMs and group DMs are always synced; this picker doesn't show
 *     them. The description in the Sheet header makes that explicit.
 *   - Newly added channels get a 7-day backfill on next sync, surfaced
 *     in the help text below the Save button so the user knows what to
 *     expect.
 */

interface Channel {
  id: string;
  name: string;
  is_private: boolean;
  is_member: boolean;
  num_members: number | null;
  topic: string | null;
  purpose: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId: string;
  connectionLabel: string;
  onSaved?: (monitoredCount: number) => void;
}

export function SlackChannelPicker({
  open,
  onOpenChange,
  connectionId,
  connectionLabel,
  onSaved,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [originalSelected, setOriginalSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");

  // Load fresh on every open so the channel list reflects the user's
  // current Slack membership (channels join/leave between picker visits).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/connect/slack/${connectionId}/channels`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error ?? `HTTP ${r.status}`);
        return r.json();
      })
      .then((data: { channels: Channel[]; monitored: string[] }) => {
        if (cancelled) return;
        setChannels(data.channels);
        const initial = new Set(data.monitored);
        setSelected(initial);
        setOriginalSelected(new Set(initial));
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Couldn't load channels");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, connectionId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return channels;
    return channels.filter((c) => c.name.toLowerCase().includes(q));
  }, [channels, query]);

  // Compute the diff so the help text + save button can show exactly
  // what's about to change. New channels get the bootstrap message.
  const { added, removed } = useMemo(() => {
    const a: string[] = [];
    const r: string[] = [];
    for (const id of selected) if (!originalSelected.has(id)) a.push(id);
    for (const id of originalSelected) if (!selected.has(id)) r.push(id);
    return { added: a, removed: r };
  }, [selected, originalSelected]);

  const dirty = added.length > 0 || removed.length > 0;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/connect/slack/${connectionId}/channels`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monitored: Array.from(selected) }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      onSaved?.(selected.size);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[480px] sm:max-w-[480px] flex flex-col">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Hash className="h-4 w-4" />
            Slack channels · {connectionLabel}
          </SheetTitle>
          <SheetDescription>
            Pick which public and private channels Mashi monitors. DMs and
            group DMs are always synced. Newly-added channels get a 7-day
            history backfill on the next sync.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-3 flex flex-1 flex-col min-h-0 gap-3">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter channels by name..."
              className="pl-7 text-[12px]"
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded border border-destructive/40 bg-destructive/10 p-2 text-[11px] text-destructive">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{error}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setError(null)}
                aria-label="Dismiss"
                className="mashi-icon-glow ml-auto h-4 w-4 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          )}

          <div className="flex-1 min-h-0 overflow-y-auto rounded border border-border/40">
            {loading ? (
              <div className="flex items-center justify-center gap-2 p-8 text-[11px] text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading channels...
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-6 text-center text-[11px] text-muted-foreground">
                {channels.length === 0
                  ? "No channels found in this workspace."
                  : "No channels match your filter."}
              </div>
            ) : (
              <ul className="divide-y divide-border/30">
                {filtered.map((c) => {
                  const checked = selected.has(c.id);
                  const isNew = checked && !originalSelected.has(c.id);
                  return (
                    <li key={c.id}>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => toggle(c.id)}
                        className={cn(
                          "flex h-auto w-full items-start justify-start gap-2.5 whitespace-normal rounded-none px-3 py-2 text-left font-normal hover:bg-secondary/40",
                          checked && "bg-primary/5 hover:bg-primary/10"
                        )}
                      >
                        <div
                          className={cn(
                            "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                            checked
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border bg-background"
                          )}
                        >
                          {checked && <Check className="h-3 w-3" />}
                        </div>
                        {c.is_private ? (
                          <Lock className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                        ) : (
                          <Hash className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[12px] font-medium text-foreground">
                              {c.name}
                            </span>
                            {isNew && (
                              <span className="rounded bg-primary/15 px-1 py-0.5 text-[9px] uppercase tracking-wider text-primary">
                                new
                              </span>
                            )}
                            {c.num_members != null && (
                              <span className="ml-auto text-[10px] text-muted-foreground">
                                {c.num_members} members
                              </span>
                            )}
                          </div>
                          {(c.topic || c.purpose) && (
                            <div className="line-clamp-1 text-[11px] text-muted-foreground">
                              {c.topic || c.purpose}
                            </div>
                          )}
                        </div>
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="flex flex-col gap-2 border-t border-border/40 pt-3">
            <div className="text-[11px] text-muted-foreground">
              {dirty ? (
                <>
                  {added.length > 0 && (
                    <span>
                      <span className="text-primary">+{added.length}</span> new
                      {added.length === 1 ? " channel" : " channels"} (7-day backfill)
                    </span>
                  )}
                  {added.length > 0 && removed.length > 0 && <span> · </span>}
                  {removed.length > 0 && (
                    <span>
                      <span className="text-destructive">-{removed.length}</span> removed
                    </span>
                  )}
                </>
              ) : (
                <span>{selected.size} monitored · no changes</span>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onOpenChange(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={save}
                disabled={!dirty || saving}
                className="gap-1.5"
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
                Save
              </Button>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
