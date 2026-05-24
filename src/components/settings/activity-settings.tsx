"use client";

/**
 * Settings → Activity Watcher.
 *
 * Three sub-sections:
 *   1. Enable / pause toggle — flips activity_settings.enabled.
 *      Without enabled = true, heartbeats are silently dropped, so this
 *      is the master switch.
 *   2. Ignore lists — comma-separated apps + domains that the matcher
 *      should never act on. (Currently advisory; the matcher itself
 *      doesn't yet enforce these. See follow-up note in the page.)
 *   3. API tokens — mint a token with `activity:write` scope for the
 *      browser extension or Mac helper to authenticate heartbeats.
 *      Plaintext shown once. Wraps POST /api/mcp/tokens.
 */

import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Copy, KeyRound, Pause, Play, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

interface TokenRow {
  id: string;
  name: string;
  token_prefix: string;
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

interface SettingsShape {
  enabled: boolean;
  paused_until: string | null;
  ignore_apps: string[];
  ignore_domains: string[];
}

interface Props {
  initial: SettingsShape;
  tokens: TokenRow[];
}

const SETTINGS_KEY = ["activity_settings"] as const;
const TOKENS_KEY = ["mashi_api_tokens"] as const;

export function ActivitySettings({ initial, tokens: initialTokens }: Props) {
  const qc = useQueryClient();

  // Server pre-fetched both, but we re-query so client-side mutations
  // get fresh data without a hard reload.
  const settings = useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: async (): Promise<SettingsShape> => {
      const res = await fetch("/api/activity/settings");
      if (!res.ok) return initial;
      return (await res.json()) as SettingsShape;
    },
    initialData: initial,
  });

  const tokens = useQuery({
    queryKey: TOKENS_KEY,
    queryFn: async (): Promise<TokenRow[]> => {
      const res = await fetch("/api/mcp/tokens");
      if (!res.ok) return initialTokens;
      const j = (await res.json()) as { tokens: TokenRow[] };
      return j.tokens ?? [];
    },
    initialData: initialTokens,
  });

  const save = useMutation({
    mutationFn: async (patch: Partial<SettingsShape>) => {
      const res = await fetch("/api/activity/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error("save failed");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: SETTINGS_KEY }),
  });

  const pause = useMutation({
    mutationFn: async (durationMinutes: number | null) => {
      const path = durationMinutes === null ? "/api/activity/resume" : "/api/activity/pause";
      const res = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          durationMinutes === null ? {} : { duration_minutes: durationMinutes }
        ),
      });
      if (!res.ok) throw new Error("pause failed");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: SETTINGS_KEY }),
  });

  // React Compiler's purity rule forbids Date.now() during render. We tick
  // a `now` state every 30s so the "Paused / Resumes at X" badge updates
  // without each render reading a fresh clock value during reconciliation.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const isPaused =
    !!settings.data?.paused_until &&
    new Date(settings.data.paused_until).getTime() > now;
  const enabled = settings.data?.enabled ?? false;

  return (
    <div className="flex flex-col gap-8">
      <EnableSection
        enabled={enabled}
        isPaused={isPaused}
        pausedUntil={settings.data?.paused_until ?? null}
        onToggle={(v) => save.mutate({ enabled: v })}
        onPause={(mins) => pause.mutate(mins)}
        saving={save.isPending || pause.isPending}
      />

      <IgnoreListsSection
        ignoreApps={settings.data?.ignore_apps ?? []}
        ignoreDomains={settings.data?.ignore_domains ?? []}
        onSave={(patch) => save.mutate(patch)}
        saving={save.isPending}
      />

      <TokensSection tokens={tokens.data ?? []} />
    </div>
  );
}

function EnableSection({
  enabled,
  isPaused,
  pausedUntil,
  onToggle,
  onPause,
  saving,
}: {
  enabled: boolean;
  isPaused: boolean;
  pausedUntil: string | null;
  onToggle: (v: boolean) => void;
  onPause: (mins: number | null) => void;
  saving: boolean;
}) {
  return (
    <section className="flex flex-col gap-3">
      <header>
        <h2 className="text-sm font-semibold">Watcher</h2>
        <p className="text-xs text-muted-foreground">
          Mashi watches your cloud signals (and, once you install the
          helper/extension, your laptop) and suggests state changes.
          You always approve.
        </p>
      </header>
      <div className="flex items-center justify-between rounded-lg border bg-card/60 p-4">
        <div className="flex flex-col gap-0.5">
          <Label htmlFor="watcher-enabled" className="text-sm font-medium">
            Enable Activity Watcher
          </Label>
          <span className="text-xs text-muted-foreground">
            Off by default. Disabling stops all heartbeats immediately.
          </span>
        </div>
        <Switch
          id="watcher-enabled"
          checked={enabled}
          onCheckedChange={onToggle}
          disabled={saving}
        />
      </div>

      {enabled && (
        <div className="flex items-center justify-between rounded-lg border bg-card/60 p-4">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">
              {isPaused ? "Paused" : "Live"}
            </span>
            <span className="text-xs text-muted-foreground">
              {isPaused && pausedUntil
                ? `Resumes at ${new Date(pausedUntil).toLocaleString()}`
                : "Heartbeats are flowing."}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {isPaused ? (
              <Button
                size="sm"
                variant="default"
                disabled={saving}
                onClick={() => onPause(null)}
              >
                <Play className="mr-1 h-3 w-3" />
                Resume
              </Button>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={saving}
                  onClick={() => onPause(60)}
                >
                  <Pause className="mr-1 h-3 w-3" />
                  Pause 1h
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={saving}
                  onClick={() => onPause(60 * 4)}
                >
                  <Pause className="mr-1 h-3 w-3" />
                  Pause 4h
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={saving}
                  onClick={() => onPause(60 * 24)}
                >
                  <Pause className="mr-1 h-3 w-3" />
                  Pause today
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function IgnoreListsSection({
  ignoreApps,
  ignoreDomains,
  onSave,
  saving,
}: {
  ignoreApps: string[];
  ignoreDomains: string[];
  onSave: (patch: Partial<SettingsShape>) => void;
  saving: boolean;
}) {
  const [apps, setApps] = useState(ignoreApps.join(", "));
  const [domains, setDomains] = useState(ignoreDomains.join(", "));

  const handleSave = useCallback(() => {
    onSave({
      ignore_apps: apps
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      ignore_domains: domains
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    });
  }, [apps, domains, onSave]);

  return (
    <section className="flex flex-col gap-3">
      <header>
        <h2 className="text-sm font-semibold">Ignore lists</h2>
        <p className="text-xs text-muted-foreground">
          Apps and domains the watcher should never act on. Useful for
          private surfaces (banking, medical, personal email). Stored
          server-side. (Today the feeders honor these; the matcher
          enforcement is a near-term follow-up.)
        </p>
      </header>
      <div className="grid grid-cols-1 gap-3 rounded-lg border bg-card/60 p-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor="ignore-apps" className="text-xs">
            Apps (comma-separated)
          </Label>
          <Input
            id="ignore-apps"
            placeholder="1Password, Banking, Therapist Notes"
            value={apps}
            onChange={(e) => setApps(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="ignore-domains" className="text-xs">
            Domains (comma-separated)
          </Label>
          <Input
            id="ignore-domains"
            placeholder="chase.com, mybank.com"
            value={domains}
            onChange={(e) => setDomains(e.target.value)}
          />
        </div>
        <div className="flex justify-end">
          <Button size="sm" onClick={handleSave} disabled={saving}>
            Save ignore lists
          </Button>
        </div>
      </div>
    </section>
  );
}

function TokensSection({ tokens }: { tokens: TokenRow[] }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [plaintext, setPlaintext] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: async (): Promise<{ plaintext: string }> => {
      const res = await fetch("/api/mcp/tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || "Activity feeder",
          scopes: ["read", "activity:write"],
        }),
      });
      if (!res.ok) throw new Error("token create failed");
      return (await res.json()) as { plaintext: string };
    },
    onSuccess: (data) => {
      setPlaintext(data.plaintext);
      setName("");
      qc.invalidateQueries({ queryKey: TOKENS_KEY });
    },
  });

  const activityTokens = tokens.filter((t) =>
    t.scopes.includes("activity:write")
  );

  return (
    <section className="flex flex-col gap-3">
      <header>
        <h2 className="text-sm font-semibold">Feeder tokens</h2>
        <p className="text-xs text-muted-foreground">
          A token with the <code>activity:write</code> scope lets a
          browser extension or Mac helper send heartbeats to{" "}
          <code>/api/activity/heartbeat</code>. Plaintext is shown once
          and cannot be recovered — copy it immediately.
        </p>
      </header>

      <div className="flex items-center gap-2 rounded-lg border bg-card/60 p-4">
        <Input
          placeholder="Token name (e.g. 'My MacBook helper')"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex-1"
        />
        <Button
          size="sm"
          onClick={() => create.mutate()}
          disabled={create.isPending}
        >
          <Plus className="mr-1 h-3 w-3" />
          Generate
        </Button>
      </div>

      {plaintext && (
        <div className="rounded-lg border border-primary/40 bg-primary/15 p-4">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium">
            <KeyRound className="h-3.5 w-3.5" />
            New token — copy it now. It will not be shown again.
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded bg-card px-2 py-1.5 text-xs">
              {plaintext}
            </code>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => navigator.clipboard.writeText(plaintext)}
            >
              <Copy className="mr-1 h-3 w-3" />
              Copy
            </Button>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 h-auto px-0 text-xs text-muted-foreground hover:bg-transparent hover:text-foreground"
            onClick={() => setPlaintext(null)}
          >
            Dismiss
          </Button>
        </div>
      )}

      {activityTokens.length > 0 && (
        <div className="rounded-lg border bg-card/60 p-4">
          <div className="mb-2 text-xs font-medium">
            Existing feeder tokens
          </div>
          <ul className="flex flex-col gap-1.5 text-xs">
            {activityTokens.map((t) => (
              <li key={t.id} className="flex items-center gap-2">
                <KeyRound className="h-3 w-3 text-muted-foreground" />
                <span className="font-medium">{t.name}</span>
                <code className="text-muted-foreground">{t.token_prefix}…</code>
                <span className="ml-auto text-muted-foreground">
                  {t.last_used_at
                    ? `last used ${new Date(t.last_used_at).toLocaleDateString()}`
                    : "never used"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
