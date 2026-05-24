"use client";

/**
 * Settings → Activity Monitor.
 *
 * Sub-sections (in order):
 *   1. Setup — three-panel accordion walking through the install paths:
 *      Cloud signals (zero install), Browser extension, Mac helper.
 *   2. Enable / pause toggle — flips activity_settings.enabled.
 *      Without enabled = true, heartbeats are silently dropped, so this
 *      is the master switch.
 *   3. Ignore lists — comma-separated apps + domains that the matcher
 *      should never act on. (Currently advisory; the matcher itself
 *      doesn't yet enforce these. See follow-up note in the page.)
 *   4. API tokens — mint a token with `activity:write` scope for the
 *      browser extension or Mac helper to authenticate heartbeats.
 *      Plaintext shown once. Wraps POST /api/mcp/tokens.
 */

import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Cloud, Copy, KeyRound, Laptop, Pause, Play, Plus, Puzzle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

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
      <header className="flex items-center gap-2">
        <h1 className="text-base font-semibold tracking-tight">
          Activity Monitor
        </h1>
        <Badge variant="primary">BETA</Badge>
      </header>

      <SetupSection />

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

/**
 * Setup — onboarding accordion covering the three install paths. Cloud
 * signals require zero install, the browser extension and Mac helper
 * unlock progressively deeper coverage. Each panel is keyboard-navigable
 * (shadcn Accordion → Radix primitives).
 */
function SetupSection() {
  return (
    <section className="flex flex-col gap-3">
      <header>
        <h2 className="text-sm font-semibold">Setup</h2>
        <p className="text-xs text-muted-foreground">
          Pick one or more install paths. The cloud feeder runs
          automatically once you enable the monitor below. The browser
          extension and Mac helper are optional, deeper coverage.
        </p>
      </header>
      <Accordion
        type="single"
        collapsible
        className="rounded-lg border bg-card/60"
      >
        <AccordionItem value="cloud" className="px-4">
          <AccordionTrigger>
            <span className="flex items-center gap-2">
              <Cloud className="h-4 w-4 text-primary" />
              <span>Cloud signals</span>
              <Badge variant="outline">No install</Badge>
            </span>
          </AccordionTrigger>
          <AccordionContent className="space-y-4 text-xs text-muted-foreground">
            <p>
              Get suggestions from Linear, Gmail, and Slack — zero install
              required.
            </p>
            <div>
              <div className="mb-1 text-xs font-medium text-foreground">
                Steps
              </div>
              <ol className="ml-4 list-decimal space-y-1.5">
                <li>
                  Toggle <span className="font-medium">Enable Activity Monitor</span>{" "}
                  below. That&apos;s it.
                </li>
                <li>
                  Wait up to 15 minutes for the next sync cycle, or trigger one
                  immediately from{" "}
                  <span className="font-medium">
                    Settings → Connections → Sync all
                  </span>
                  .
                </li>
                <li>
                  Matched events appear in the cockpit&apos;s Pending Suggestions
                  surface.
                </li>
              </ol>
            </div>
            <div>
              <div className="mb-1 text-xs font-medium text-foreground">
                What gets captured
              </div>
              <ul className="ml-4 list-disc space-y-1">
                <li>Linear: when an issue you own moves to Done or Cancelled.</li>
                <li>Gmail: when a thread you&apos;re in drops out of your Inbox.</li>
                <li>Slack: when you send a message in a channel.</li>
              </ul>
            </div>
            <p>
              Nothing leaves Mashi&apos;s servers — this runs as part of the
              existing sync.
            </p>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="browser" className="px-4">
          <AccordionTrigger>
            <span className="flex items-center gap-2">
              <Puzzle className="h-4 w-4 text-primary" />
              <span>Browser extension</span>
              <Badge variant="outline">Chromium + Firefox</Badge>
            </span>
          </AccordionTrigger>
          <AccordionContent className="space-y-4 text-xs text-muted-foreground">
            <p>
              Add tab-focus signals from your browser so Mashi knows which
              Linear issue, Gmail thread, or work URL you&apos;re currently
              looking at. Internal side-load — not on any store.
            </p>
            <div>
              <div className="mb-1 text-xs font-medium text-foreground">
                Setup (Chrome / Brave / Arc / Edge)
              </div>
              <ol className="ml-4 list-decimal space-y-1.5">
                <li>
                  Generate a token below in <span className="font-medium">Feeder tokens</span>{" "}
                  with the <code>activity:write</code> scope.
                </li>
                <li>
                  From the Mashi repo:
                  <pre className="mt-1 overflow-x-auto rounded bg-card px-2 py-1.5 text-[11px] text-foreground">
                    <code>
                      cd apps/browser-ext{"\n"}
                      npm install{"\n"}
                      npm run build
                    </code>
                  </pre>
                </li>
                <li>
                  Open <code>chrome://extensions</code>, enable Developer mode,
                  click <span className="font-medium">Load unpacked</span>, select{" "}
                  <code>apps/browser-ext/</code>.
                </li>
                <li>
                  Right-click the Mashi icon → <span className="font-medium">Options</span>.
                  Paste your token. Save → Test connection.
                </li>
              </ol>
            </div>
            <div>
              <div className="mb-1 text-xs font-medium text-foreground">
                Setup (Firefox 121+)
              </div>
              <ol className="ml-4 list-decimal space-y-1.5">
                <li>Same build steps as above.</li>
                <li>
                  Open <code>about:debugging</code> →{" "}
                  <span className="font-medium">This Firefox</span> →{" "}
                  <span className="font-medium">Load Temporary Add-on</span>
                </li>
                <li>
                  Select <code>apps/browser-ext/manifest.json</code>.
                </li>
                <li>
                  Right-click icon → <span className="font-medium">Manage Extension</span> →{" "}
                  <span className="font-medium">Preferences</span>. Paste token. Save.
                </li>
              </ol>
              <p className="mt-1.5 italic">
                Firefox drops temporary add-ons on restart. Re-load on each
                launch until we ship a signed XPI.
              </p>
            </div>
            <div>
              <div className="mb-1 text-xs font-medium text-foreground">
                What gets captured
              </div>
              <ul className="ml-4 list-disc space-y-1">
                <li>URL of the active tab.</li>
                <li>Title of the active tab.</li>
                <li>Timestamp of focus.</li>
              </ul>
            </div>
            <p>
              Default ignore list covers banking, password managers, therapy
              domains. Add your own in Options. Page content, form fields,
              cookies — never captured.
            </p>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="mac" className="px-4">
          <AccordionTrigger>
            <span className="flex items-center gap-2">
              <Laptop className="h-4 w-4 text-primary" />
              <span>Mac desktop helper</span>
              <Badge variant="outline">Deeper coverage</Badge>
            </span>
          </AccordionTrigger>
          <AccordionContent className="space-y-4 text-xs text-muted-foreground">
            <p>
              Adds signals from Cursor, Claude Desktop, Slack desktop, Finder,
              terminal, and active-browser URLs. Mac-only. Tauri-based menubar
              app — internal distribution.
            </p>
            <div>
              <div className="mb-1 text-xs font-medium text-foreground">
                Requires
              </div>
              <ul className="ml-4 list-disc space-y-1">
                <li>macOS 12+</li>
                <li>
                  Xcode CLT (<code>xcode-select --install</code>)
                </li>
                <li>
                  Rust toolchain (
                  <code>
                    curl --proto &apos;=https&apos; --tlsv1.2 -sSf
                    https://sh.rustup.rs | sh
                  </code>
                  )
                </li>
                <li>Node 20+</li>
              </ul>
            </div>
            <div>
              <div className="mb-1 text-xs font-medium text-foreground">
                Build + install
              </div>
              <ol className="ml-4 list-decimal space-y-1.5">
                <li>Generate a token below.</li>
                <li>
                  Drop a 1024×1024 PNG at{" "}
                  <code>apps/mac-helper/src-tauri/icons/icon-1024.png</code>{" "}
                  (any reasonable square image is fine for now).
                </li>
                <li>
                  From the Mashi repo:
                  <pre className="mt-1 overflow-x-auto rounded bg-card px-2 py-1.5 text-[11px] text-foreground">
                    <code>
                      cd apps/mac-helper{"\n"}
                      pnpm install{"\n"}
                      pnpm tauri icon src-tauri/icons/icon-1024.png   # one-time
                      {"\n"}
                      pnpm tauri build
                    </code>
                  </pre>
                </li>
                <li>
                  Drag{" "}
                  <code>
                    apps/mac-helper/src-tauri/target/release/bundle/macos/Mashi.app
                  </code>{" "}
                  to <code>/Applications</code>.
                </li>
                <li>
                  Right-click → <span className="font-medium">Open</span> (the
                  app is unsigned for now — Gatekeeper otherwise blocks
                  double-click; one-time prompt).
                </li>
                <li>
                  Grant Accessibility permission when prompted (System Settings
                  → Privacy &amp; Security → Accessibility → toggle Mashi on).
                </li>
                <li>Settings window auto-opens. Paste token, save.</li>
              </ol>
            </div>
            <div>
              <div className="mb-1 text-xs font-medium text-foreground">
                What gets captured (every 30s, unless idle &gt; 5min)
              </div>
              <ul className="ml-4 list-disc space-y-1">
                <li>Frontmost app name.</li>
                <li>Window title of the front app.</li>
                <li>URL of the active browser tab (per-browser Automation permission).</li>
                <li>
                  Nothing else. No screen content, keystrokes, clipboard,
                  microphone, files.
                </li>
              </ul>
            </div>
            <p>
              Three independent kill switches: system idle (5min), menubar
              Pause, or Disable toggle below.
            </p>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </section>
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
        <h2 className="text-sm font-semibold">Monitor</h2>
        <p className="text-xs text-muted-foreground">
          Mashi watches your cloud signals (and, once you install the
          helper/extension, your laptop) and suggests state changes.
          You always approve.
        </p>
      </header>
      <div className="flex items-center justify-between rounded-lg border bg-card/60 p-4">
        <div className="flex flex-col gap-0.5">
          <Label htmlFor="watcher-enabled" className="text-sm font-medium">
            Enable Activity Monitor
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
