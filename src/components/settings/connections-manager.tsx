"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Plus,
  Unplug,
  AlertTriangle,
  Check,
  Key,
  Loader2,
  X,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { LinearOAuthProvider } from "@/lib/oauth/providers/linear";
import { GmailOAuthProvider } from "@/lib/oauth/providers/gmail";
import { GoogleCalendarOAuthProvider } from "@/lib/oauth/providers/gcal";
import { SlackOAuthProvider } from "@/lib/oauth/providers/slack";
import { OutlookOAuthProvider } from "@/lib/oauth/providers/outlook";
import { MicrosoftCalendarOAuthProvider } from "@/lib/oauth/providers/mscal";
import { FirefliesOAuthProvider } from "@/lib/oauth/providers/fireflies";
import type { ProviderKey, ProviderMeta } from "@/lib/oauth/types";
import { useSyncStore } from "@/store/sync-store";

// We can't import the server-side registry from a client component, so we
// recreate the list of visible provider meta here.
const PROVIDER_META: ProviderMeta[] = [
  LinearOAuthProvider.meta,
  GmailOAuthProvider.meta,
  GoogleCalendarOAuthProvider.meta,
  SlackOAuthProvider.meta,
  OutlookOAuthProvider.meta,
  MicrosoftCalendarOAuthProvider.meta,
  FirefliesOAuthProvider.meta,
];

interface ConnectionRow {
  id: string;
  provider: ProviderKey;
  account_email: string | null;
  account_label: string;
  account_avatar_url: string | null;
  company_id: string | null;
  scopes: string[];
  last_synced_at: string | null;
  last_sync_status: "idle" | "syncing" | "success" | "error" | "needs_reauth";
  last_sync_error: string | null;
  expires_at: string | null;
  created_at: string;
}

interface CompanyOption {
  id: string;
  name: string;
  color_hex: string;
}

export function ConnectionsManager({
  initialConnections,
  companies,
}: {
  initialConnections: ConnectionRow[];
  companies: CompanyOption[];
}) {
  const router = useRouter();
  const search = useSearchParams();

  const [connections, setConnections] = useState(initialConnections);
  const [banner, setBanner] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const [apiKeyDialogFor, setApiKeyDialogFor] = useState<ProviderKey | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const [consolidating, setConsolidating] = useState(false);

  // Global sync state — lives in zustand so a navigation away from this
  // settings page doesn't kill in-flight progress. The persistent top
  // banner in AppShell reads from the same store.
  const isSyncingAll = useSyncStore((s) => s.isSyncing);
  const inFlightIds = useSyncStore((s) => s.inFlightIds);
  const runSyncAll = useSyncStore((s) => s.runSyncAll);
  const runSyncOne = useSyncStore((s) => s.runSyncOne);

  async function consolidateNow() {
    if (
      !confirm(
        "Consolidate duplicates? Mashi will use Haiku to merge S2D items that are about the same underlying work into one canonical row per work unit. The duplicates' source signals get attached to the canonical row."
      )
    )
      return;
    setConsolidating(true);
    setBanner(null);
    try {
      const res = await fetch("/api/consolidate", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setBanner({ kind: "err", msg: data.error ?? "Consolidate failed" });
        return;
      }
      setBanner({
        kind: "ok",
        msg: `Consolidated · ${data.clustersFound} clusters found · ${data.merged} duplicate items merged into canonical rows`,
      });
      router.refresh();
    } catch (err) {
      setBanner({
        kind: "err",
        msg: err instanceof Error ? err.message : "Consolidate failed",
      });
    } finally {
      setConsolidating(false);
    }
  }

  async function reconcileNow() {
    setReconciling(true);
    setBanner(null);
    try {
      const res = await fetch("/api/reconcile", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setBanner({ kind: "err", msg: data.error ?? "Reconcile failed" });
        return;
      }
      setBanner({
        kind: "ok",
        msg: `Reconciled · ${data.total} closed · linear ${data.byProvider[0]?.closed ?? 0} · gmail ${data.byProvider[1]?.closed ?? 0} · slack ${data.byProvider[2]?.closed ?? 0} · fireflies-aged ${data.fireflies ?? 0} · stale ${data.stale ?? 0} · cascade ${data.cascaded ?? 0}`,
      });
      router.refresh();
    } catch (err) {
      setBanner({
        kind: "err",
        msg: err instanceof Error ? err.message : "Reconcile failed",
      });
    } finally {
      setReconciling(false);
    }
  }

  async function syncAll() {
    if (connections.length === 0) return;
    setBanner(null);
    // Delegate the loop to the global sync store so it survives unmount
    // when the user navigates away mid-sync. The persistent top banner in
    // AppShell reads from the same store and shows progress everywhere.
    await runSyncAll(
      connections.map((c) => ({
        id: c.id,
        provider: c.provider,
        account_label: c.account_label,
      }))
    );
    router.refresh();
  }

  async function syncNow(connectionId: string, provider: ProviderKey) {
    const conn = connections.find((c) => c.id === connectionId);
    if (!conn) return;
    const result = await runSyncOne({
      id: conn.id,
      provider,
      account_label: conn.account_label,
    });
    setBanner({ kind: result.kind, msg: result.msg });
    if (result.kind === "ok") {
      setConnections((prev) =>
        prev.map((c) =>
          c.id === connectionId
            ? { ...c, last_synced_at: new Date().toISOString(), last_sync_status: "success" }
            : c
        )
      );
      router.refresh();
    }
  }

  // Keep local state in sync with fresh server data on every render
  // (re-renders happen after router.refresh() following OAuth callbacks).
  useEffect(() => {
    setConnections(initialConnections);
  }, [initialConnections]);

  // Handle ?connected=<provider> / ?error=... / ?dialog=fireflies from callbacks
  useEffect(() => {
    const connected = search.get("connected");
    const err = search.get("error");
    const dialog = search.get("dialog");
    if (connected) {
      setBanner({ kind: "ok", msg: `Connected ${prettyProvider(connected)}.` });
      router.replace("/settings/connections");
      router.refresh();
    } else if (err) {
      setBanner({ kind: "err", msg: err });
      router.replace("/settings/connections");
      router.refresh();
    }
    if (dialog && PROVIDER_META.some((p) => p.key === dialog)) {
      setApiKeyDialogFor(dialog as ProviderKey);
      router.replace("/settings/connections");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const groupedByProvider = useMemo(() => {
    const out = new Map<ProviderKey, ConnectionRow[]>();
    for (const c of connections) {
      if (!out.has(c.provider)) out.set(c.provider, []);
      out.get(c.provider)!.push(c);
    }
    return out;
  }, [connections]);

  async function disconnect(id: string) {
    if (!confirm("Disconnect this account? Mashi will stop syncing from it.")) return;
    const res = await fetch(`/api/connections/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setBanner({ kind: "err", msg: "Disconnect failed." });
      return;
    }
    setConnections((prev) => prev.filter((c) => c.id !== id));
    setBanner({ kind: "ok", msg: "Disconnected." });
  }

  async function updateCompany(id: string, companyId: string | null) {
    const res = await fetch(`/api/connections/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company_id: companyId }),
    });
    if (res.ok) {
      setConnections((prev) =>
        prev.map((c) => (c.id === id ? { ...c, company_id: companyId } : c))
      );
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Integrations</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Each portfolio company has its own Linear, Slack, Gmail, etc. Connect each
            one separately — Mashi keeps tokens encrypted, scoped per account, and
            you can revoke any of them with one click.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            onClick={consolidateNow}
            disabled={consolidating || reconciling || isSyncingAll}
            variant="outline"
            className="gap-1.5"
            size="sm"
            title="Merge S2D items that are about the same underlying work into one canonical row per work unit"
          >
            <ShieldCheck className={cn("h-3.5 w-3.5", consolidating && "animate-pulse")} />
            {consolidating ? "Consolidating…" : "Consolidate dupes"}
          </Button>
          <Button
            onClick={reconcileNow}
            disabled={reconciling || isSyncingAll || connections.length === 0}
            variant="outline"
            className="gap-1.5"
            size="sm"
            title="Close S2D items whose source has clearly moved on (Linear completed, you replied in thread, etc.)"
          >
            <ShieldCheck className={cn("h-3.5 w-3.5", reconciling && "animate-pulse")} />
            {reconciling ? "Reconciling…" : "Reconcile statuses"}
          </Button>
          <Button
            onClick={syncAll}
            disabled={isSyncingAll || connections.length === 0}
            className="gap-1.5"
            size="sm"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isSyncingAll && "animate-spin")} />
            {isSyncingAll ? "Syncing…" : "Sync all"}
          </Button>
        </div>
      </div>

      {banner && (
        <div
          className={cn(
            "flex items-start gap-2 rounded border p-2.5 text-[12px]",
            banner.kind === "ok"
              ? "border-primary/30 bg-primary/10 text-foreground"
              : "border-destructive/30 bg-destructive/10 text-destructive"
          )}
        >
          {banner.kind === "ok" ? (
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          ) : (
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          )}
          <span className="flex-1">{banner.msg}</span>
          <button onClick={() => setBanner(null)} className="text-muted-foreground hover:text-foreground">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="space-y-3">
        {PROVIDER_META.map((meta) => {
          const conns = groupedByProvider.get(meta.key) ?? [];
          return (
            <ProviderRow
              key={meta.key}
              meta={meta}
              connections={conns}
              companies={companies}
              syncingIds={inFlightIds}
              onDisconnect={disconnect}
              onUpdateCompany={updateCompany}
              onSync={syncNow}
            />
          );
        })}
      </div>

      {apiKeyDialogFor && (
        <ApiKeyDialog
          provider={apiKeyDialogFor}
          onClose={() => setApiKeyDialogFor(null)}
          onSuccess={() => {
            setApiKeyDialogFor(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function ProviderRow({
  meta,
  connections,
  companies,
  syncingIds,
  onDisconnect,
  onUpdateCompany,
  onSync,
}: {
  meta: ProviderMeta;
  connections: ConnectionRow[];
  companies: CompanyOption[];
  syncingIds: Set<string>;
  onDisconnect: (id: string) => void;
  onUpdateCompany: (id: string, companyId: string | null) => void;
  onSync: (id: string, provider: ProviderKey) => void;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-white font-semibold"
            style={{ backgroundColor: meta.brandColor }}
            aria-hidden
          >
            {meta.label[0]}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-medium">{meta.label}</h3>
              {connections.length > 0 && (
                <span className="rounded border border-border/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {connections.length} connected
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{meta.description}</p>
          </div>
          <a
            href={`/api/connect/${meta.key}`}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-card px-2 text-[11px] hover:bg-accent"
          >
            {meta.key === "fireflies" || meta.key === "linear" ? (
              <>
                <Key className="h-3 w-3" />
                Add API key{meta.supportsMultiple && connections.length > 0 ? " for another workspace" : ""}
              </>
            ) : (
              <>
                <Plus className="h-3 w-3" />
                Connect {meta.supportsMultiple && connections.length > 0 ? "another" : ""}
              </>
            )}
          </a>
        </div>

        {connections.length > 0 && (
          <ul className="mt-3 divide-y divide-border/40 rounded-md border border-border/40">
            {connections.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-3 py-2">
                {c.account_avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={c.account_avatar_url}
                    alt=""
                    className="h-5 w-5 rounded-full"
                  />
                ) : (
                  <div className="h-5 w-5 rounded-full bg-secondary" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px]">{c.account_label}</div>
                  {c.account_email && c.account_email !== c.account_label && (
                    <div className="truncate text-[10px] font-mono text-muted-foreground">
                      {c.account_email}
                    </div>
                  )}
                </div>
                <select
                  value={c.company_id ?? ""}
                  onChange={(e) =>
                    onUpdateCompany(c.id, e.target.value || null)
                  }
                  className="h-6 rounded border border-border/40 bg-background px-1.5 text-[11px] text-foreground"
                >
                  <option value="">— map to company —</option>
                  {companies.map((co) => (
                    <option key={co.id} value={co.id}>
                      {co.name}
                    </option>
                  ))}
                </select>
                {(() => {
                  // Three visual states with a clear primary CTA on each:
                  //   needs_reauth  → red "Reauth now" pill (provider rejected the token)
                  //   expiring_soon → amber "Reauth" pill (token will expire within 7 days)
                  //   healthy       → quiet "synced N ago" timestamp
                  const needsReauth = c.last_sync_status === "needs_reauth";
                  const expiringSoon = !needsReauth && isExpiringSoon(c.expires_at);

                  if (needsReauth) {
                    return (
                      <span
                        className="rounded border border-destructive/40 bg-destructive/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-destructive"
                        title={c.last_sync_error ?? undefined}
                      >
                        needs reauth
                      </span>
                    );
                  }
                  if (expiringSoon) {
                    return (
                      <span
                        className="rounded border border-amber-500/40 bg-amber-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-400"
                        title={`Token expires ${shortDate(c.expires_at!)}`}
                      >
                        expiring soon
                      </span>
                    );
                  }
                  return (
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {c.last_synced_at ? `synced ${shortDate(c.last_synced_at)}` : "not synced"}
                    </span>
                  );
                })()}
                {(() => {
                  // PRIMARY action: changes based on connection health.
                  //  - needs_reauth → loud "Reauth now" red button
                  //  - expiring_soon → amber "Reauth" button (proactive,
                  //    user can refresh before it dies)
                  //  - healthy → "Sync now" refresh icon
                  // Either way the destructive Disconnect button is still
                  // present below, just visually demoted so the primary
                  // affordance for a stale connection is to FIX it, not
                  // to remove it.
                  const needsReauth = c.last_sync_status === "needs_reauth";
                  const expiringSoon = !needsReauth && isExpiringSoon(c.expires_at);
                  if (needsReauth) {
                    return (
                      <a
                        href={`/api/connect/${c.provider}`}
                        className="inline-flex h-6 items-center gap-1 rounded-md border border-destructive/50 bg-destructive/15 px-2 text-[11px] font-medium text-destructive hover:bg-destructive/25"
                        title={c.last_sync_error ?? "Reconnect this workspace"}
                      >
                        Reauth now
                      </a>
                    );
                  }
                  if (expiringSoon) {
                    return (
                      <a
                        href={`/api/connect/${c.provider}`}
                        className="inline-flex h-6 items-center gap-1 rounded-md border border-amber-500/50 bg-amber-500/15 px-2 text-[11px] font-medium text-amber-400 hover:bg-amber-500/25"
                        title={`Refresh token before ${shortDate(c.expires_at!)}`}
                      >
                        Reauth
                      </a>
                    );
                  }
                  return (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onSync(c.id, meta.key)}
                      disabled={syncingIds.has(c.id)}
                      aria-label="Sync now"
                      className="h-6 w-6"
                      title="Sync now"
                    >
                      <RefreshCw
                        className={cn(
                          "h-3.5 w-3.5",
                          syncingIds.has(c.id) && "animate-spin"
                        )}
                      />
                    </Button>
                  );
                })()}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onDisconnect(c.id)}
                  aria-label="Disconnect"
                  // Quieter by default — only goes red on hover. The
                  // primary CTA for a stale connection is Reauth (above),
                  // not Disconnect.
                  className="h-6 w-6 text-muted-foreground/60 hover:bg-destructive/10 hover:text-destructive"
                  title="Disconnect this account"
                >
                  <Unplug className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ApiKeyDialog({
  provider,
  onClose,
  onSuccess,
}: {
  provider: ProviderKey;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setError(null);
    const res = await fetch(`/api/connect/${provider}/api-key`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: apiKey.trim() }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: "Failed" }));
      setError(data.error ?? "Failed");
      setSubmitting(false);
      return;
    }
    onSuccess();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <Card className="w-full max-w-md">
        <CardContent className="space-y-3 p-5">
          <div className="flex items-center gap-2">
            <Key className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Add {prettyProvider(provider)} API key</h3>
            <button
              onClick={onClose}
              className="ml-auto text-muted-foreground hover:text-foreground"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="text-[12px] text-muted-foreground">
            {provider === "fireflies" ? (
              "Grab a key from app.fireflies.ai → Settings → Developer Settings."
            ) : provider === "linear" ? (
              <>
                In Linear, switch to the workspace you want to connect → click
                your avatar (top-left) →{" "}
                <span className="font-medium text-foreground">Preferences</span> →{" "}
                <span className="font-medium text-foreground">Security & access</span> →
                scroll to <span className="font-medium text-foreground">Personal API keys</span>{" "}
                → New key with scopes{" "}
                <span className="font-mono">read, write, issues:create, comments:create</span>.
                One key per workspace.
                <br />
                <br />
                <span className="text-foreground/70">
                  Can&apos;t see &quot;Personal API keys&quot;? Your workspace admin has
                  restricted creation. Ask them to set{" "}
                  <span className="font-medium text-foreground">
                    Workspace settings → Security & access → API key creation
                  </span>{" "}
                  to <span className="font-mono">All members</span>, or have them
                  create a key on your behalf.
                </span>
              </>
            ) : (
              "Paste your API key."
            )}
          </p>
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="API key"
            autoFocus
            disabled={submitting}
          />
          {error && (
            <div className="flex items-start gap-2 rounded border border-destructive/30 bg-destructive/10 p-2 text-[12px] text-destructive">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" onClick={submit} disabled={submitting || apiKey.trim().length < 8}>
              {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Connect"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function prettyProvider(key: string): string {
  return PROVIDER_META.find((p) => p.key === key)?.label ?? key;
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  const diffMin = Math.round((Date.now() - d.getTime()) / 60000);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return d.toLocaleDateString();
}

function isExpiringSoon(iso: string | null): boolean {
  if (!iso) return false;
  const ms = new Date(iso).getTime() - Date.now();
  // Warn when token has less than 24h of life left (but not already past)
  return ms > 0 && ms < 86_400_000;
}
