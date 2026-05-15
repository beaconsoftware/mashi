"use client";

import { create } from "zustand";
import type { ProviderKey } from "@/lib/oauth/types";

/**
 * Global sync state.
 *
 * Why a store and not component state: the user can kick off "Sync all" from
 * Settings → Connections and then navigate to S2D or anywhere else. The fetch
 * calls keep running (they're not tied to a component), but if the progress
 * state lives in the Settings component, it gets thrown away on unmount and
 * the UI loses all visibility into a long-running operation.
 *
 * Moving the loop into the store means:
 *   - The loop runs to completion regardless of which page is mounted.
 *   - A persistent top banner in the dashboard layout subscribes to this
 *     store and shows progress everywhere.
 *   - Only one sync can run at a time (guarded by isSyncing).
 *
 * No persistence: if the tab closes mid-sync, the loop dies with it. That's
 * fine — the user can re-trigger. We don't try to resume.
 */

interface ConnectionLite {
  id: string;
  provider: ProviderKey;
  account_label: string;
}

interface SyncProgress {
  current: number;
  total: number;
  label: string;
}

interface SyncTotals {
  synced: number;
  failed: number;
  created: number;
  updated: number;
  closed: number;
  reconciled: number;
}

interface SyncResult {
  kind: "ok" | "err";
  msg: string;
  at: number;
}

interface SyncState {
  isSyncing: boolean;
  progress: SyncProgress | null;
  totals: SyncTotals;
  /** Last completed sync result; shown briefly then auto-cleared. */
  lastResult: SyncResult | null;
  /** Per-connection in-flight set, so individual rows can show a spinner too. */
  inFlightIds: Set<string>;

  runSyncAll: (connections: ConnectionLite[]) => Promise<void>;
  runSyncOne: (connection: ConnectionLite) => Promise<SyncResult>;
  clearResult: () => void;
}

// Recommended order: producers (Linear) before triagers that close (Fireflies)
const SYNC_ORDER: ProviderKey[] = [
  "linear",
  "gmail",
  "slack",
  "fireflies",
  "gcal",
  "outlook",
  "mscal",
];

const EMPTY_TOTALS: SyncTotals = {
  synced: 0,
  failed: 0,
  created: 0,
  updated: 0,
  closed: 0,
  reconciled: 0,
};

function prettyProvider(p: string): string {
  switch (p) {
    case "linear":
      return "Linear";
    case "gmail":
      return "Gmail";
    case "slack":
      return "Slack";
    case "fireflies":
      return "Fireflies";
    case "gcal":
      return "Google Calendar";
    case "outlook":
      return "Outlook";
    case "mscal":
      return "Microsoft Calendar";
    default:
      return p;
  }
}

export const useSyncStore = create<SyncState>((set, get) => ({
  isSyncing: false,
  progress: null,
  totals: { ...EMPTY_TOTALS },
  lastResult: null,
  inFlightIds: new Set(),

  clearResult: () => set({ lastResult: null }),

  runSyncOne: async (c) => {
    set((s) => ({ inFlightIds: new Set(s.inFlightIds).add(c.id) }));
    try {
      const res = await fetch(`/api/sync/${c.provider}/${c.id}`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        return { kind: "err", msg: data.error ?? "Sync failed", at: Date.now() };
      }
      const detail =
        c.provider === "linear"
          ? `${data.fetched} issues · ${data.triaged} triaged · ${data.created} created · ${data.updated} updated · ${data.closed} closed`
          : c.provider === "gmail"
          ? `${data.listed} listed · ${data.stored} new · ${data.threadsTriaged} threads · ${data.created} created · ${data.updated} updated · ${data.closed} closed`
          : c.provider === "gcal"
          ? `${data.fetched} events · ${data.triaged} triaged · ${data.created} created · ${data.updated} updated · ${data.closed} closed`
          : c.provider === "slack"
          ? `${data.conversations} convos · ${data.fetched} msgs · ${data.slicesTriaged} slices · ${data.created} created · ${data.updated} updated · ${data.closed} closed`
          : c.provider === "fireflies"
          ? `${data.fetched} transcripts · ${data.triaged} triaged · ${data.created} created · ${data.updated} updated · ${data.closed} closed`
          : "Sync complete";
      return { kind: "ok", msg: detail, at: Date.now() };
    } catch (err) {
      return {
        kind: "err",
        msg: err instanceof Error ? err.message : "Sync failed",
        at: Date.now(),
      };
    } finally {
      set((s) => {
        const next = new Set(s.inFlightIds);
        next.delete(c.id);
        return { inFlightIds: next };
      });
    }
  },

  runSyncAll: async (connections) => {
    // Guard against double-start
    if (get().isSyncing) return;
    if (connections.length === 0) return;

    const ordered = [...connections].sort((a, b) => {
      const ai = SYNC_ORDER.indexOf(a.provider);
      const bi = SYNC_ORDER.indexOf(b.provider);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

    set({
      isSyncing: true,
      progress: { current: 0, total: ordered.length, label: "Starting…" },
      totals: { ...EMPTY_TOTALS },
      lastResult: null,
    });

    const totals: SyncTotals = { ...EMPTY_TOTALS };

    for (let i = 0; i < ordered.length; i++) {
      const c = ordered[i];
      set((s) => ({
        progress: {
          current: i + 1,
          total: ordered.length,
          label: `${prettyProvider(c.provider)} — ${c.account_label}`,
        },
        inFlightIds: new Set(s.inFlightIds).add(c.id),
      }));
      try {
        const res = await fetch(`/api/sync/${c.provider}/${c.id}`, {
          method: "POST",
        });
        const data = await res.json();
        if (!res.ok) {
          totals.failed++;
          console.warn(`[sync-all] ${c.provider}/${c.id} failed:`, data.error);
        } else {
          totals.synced++;
          totals.created += data.created ?? 0;
          totals.updated += data.updated ?? 0;
          totals.closed += data.closed ?? 0;
        }
      } catch (err) {
        totals.failed++;
        console.warn(`[sync-all] ${c.provider}/${c.id} threw:`, err);
      } finally {
        set((s) => {
          const next = new Set(s.inFlightIds);
          next.delete(c.id);
          return { inFlightIds: next, totals: { ...totals } };
        });
      }
    }

    // Chained reconcile pass — close items whose source has clearly moved on
    set({
      progress: {
        current: ordered.length,
        total: ordered.length,
        label: "Reconciling…",
      },
    });
    try {
      const res = await fetch("/api/reconcile", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        totals.reconciled = data.total ?? 0;
      }
    } catch (err) {
      console.warn("[sync-all] chained reconcile failed:", err);
    }

    // Chained consolidate pass — collapse cross-source dupes into one
    // canonical work item. Per the user's directive: "balance between
    // noise and consolidation is paramount", consolidate always runs after
    // sync so per-meeting action item explosion gets cleaned up
    // automatically rather than waiting for a manual button press.
    set({
      progress: {
        current: ordered.length,
        total: ordered.length,
        label: "Consolidating dupes…",
      },
    });
    let consolidated = 0;
    try {
      const res = await fetch("/api/consolidate", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        consolidated = data.merged ?? 0;
      }
    } catch (err) {
      console.warn("[sync-all] chained consolidate failed:", err);
    }

    // Chained meeting-bundle pass — collapse Fireflies-meeting explosion
    // (one meeting → 10 separate S2Ds, all about the same initiative)
    // into one canonical row per initiative.
    set({
      progress: {
        current: ordered.length,
        total: ordered.length,
        label: "Bundling meeting items…",
      },
    });
    let bundled = 0;
    try {
      const res = await fetch("/api/bundle-meetings", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        bundled = data.itemsMerged ?? 0;
      }
    } catch (err) {
      console.warn("[sync-all] chained bundle-meetings failed:", err);
    }
    consolidated += bundled;

    const result: SyncResult = {
      kind: totals.failed > 0 ? "err" : "ok",
      msg: `Sync all done · ${totals.synced} ok${
        totals.failed ? `, ${totals.failed} failed` : ""
      } · ${totals.created} created · ${totals.updated} updated · ${totals.closed} closed · ${totals.reconciled} reconciled · ${consolidated} merged`,
      at: Date.now(),
    };

    set({
      isSyncing: false,
      progress: null,
      totals,
      lastResult: result,
    });

    // Auto-clear the banner after 10s so it doesn't linger forever
    setTimeout(() => {
      if (get().lastResult?.at === result.at) {
        set({ lastResult: null });
      }
    }, 10_000);
  },
}));
