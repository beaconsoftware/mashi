"use client";

// translucency-audit-ok: file — legacy callsites, migrate to sanctioned scale (/15, /40, /55, /60, /80, /95) case-by-case during component touch-ups.

import { useEffect, useState } from "react";
import { Copy, Trash2, Plus, KeyRound, AlertTriangle, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface TokenRow {
  id: string;
  name: string;
  token_prefix: string;
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export function ApiTokensManager() {
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [newPlaintext, setNewPlaintext] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/mcp/tokens");
    const j = await res.json();
    setTokens(j.tokens ?? []);
    setLoading(false);
  }
  useEffect(() => {
    void load();
  }, []);

  async function create() {
    if (!newName.trim() || creating) return;
    setCreating(true);
    setErr(null);
    try {
      const res = await fetch("/api/mcp/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "create failed");
      setNewPlaintext(j.plaintext);
      setNewName("");
      void load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "create failed");
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string) {
    if (!confirm("Revoke this token? Any DXT or client using it will stop working immediately.")) return;
    await fetch(`/api/mcp/tokens/${id}`, { method: "DELETE" });
    void load();
  }

  async function copyPlaintext() {
    if (!newPlaintext) return;
    await navigator.clipboard.writeText(newPlaintext);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <section className="space-y-3 rounded-lg border border-border/40 bg-card p-5">
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Create a new token</h2>
        </div>
        <p className="text-[12px] text-muted-foreground">
          Token grants read-only access to your Mashi data (board, meetings,
          messages, Linear, calendar, companies). The plaintext is shown ONCE
          on creation — save it immediately. Lost tokens can&apos;t be recovered,
          only revoked and replaced.
        </p>
        <div className="flex items-center gap-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void create();
              }
            }}
            placeholder='Name (e.g. "Claude Desktop — laptop")'
            className="h-9 flex-1"
          />
          <Button
            type="button"
            onClick={create}
            disabled={!newName.trim() || creating}
            size="sm"
            className="gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            {creating ? "Creating…" : "Create"}
          </Button>
        </div>
        {err && (
          <div className="flex items-start gap-2 rounded border border-destructive/30 bg-destructive/10 p-2 text-[12px] text-destructive">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{err}</span>
          </div>
        )}
        {newPlaintext && (
          <div className="space-y-2 rounded border border-primary/40 bg-primary/10 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-primary">
              Copy this now — it won&apos;t be shown again
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all rounded bg-background/60 px-2 py-1 font-mono text-[11px]">
                {newPlaintext}
              </code>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={copyPlaintext}
                className="h-7 gap-1.5"
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setNewPlaintext(null)}
              className="h-auto px-1 py-0.5 text-[11px] font-normal text-muted-foreground hover:text-foreground"
            >
              I&apos;ve saved it — dismiss
            </Button>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-border/40 bg-card">
        <div className="border-b border-border/30 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Your tokens
        </div>
        {loading ? (
          <div className="px-4 py-6 text-center text-[12px] text-muted-foreground">
            Loading…
          </div>
        ) : tokens.length === 0 ? (
          <div className="px-4 py-6 text-center text-[12px] text-muted-foreground">
            No tokens yet.
          </div>
        ) : (
          <ul className="divide-y divide-border/30">
            {tokens.map((t) => (
              <li
                key={t.id}
                className={cn(
                  "flex items-center gap-3 px-4 py-2.5",
                  t.revoked_at && "opacity-50"
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium">{t.name}</span>
                    {t.revoked_at && (
                      <span className="rounded border border-border/40 px-1.5 py-0.5 text-[9px] uppercase text-muted-foreground">
                        revoked
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex items-center gap-3 text-[11px] text-muted-foreground">
                    <code className="font-mono">{t.token_prefix}…</code>
                    <span>·</span>
                    <span>created {fmtAgo(t.created_at)}</span>
                    {t.last_used_at && (
                      <>
                        <span>·</span>
                        <span>last used {fmtAgo(t.last_used_at)}</span>
                      </>
                    )}
                  </div>
                </div>
                {!t.revoked_at && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => revoke(t.id)}
                    aria-label="Revoke"
                    className="mashi-icon-glow h-5 w-5 text-muted-foreground hover:text-destructive"
                    title="Revoke"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function fmtAgo(iso: string): string {
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
