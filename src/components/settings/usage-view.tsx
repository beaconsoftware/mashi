"use client";

// translucency-audit-ok: file — legacy callsites, migrate to sanctioned scale (/15, /40, /55, /60, /80, /95) case-by-case during component touch-ups.

import { useQuery } from "@tanstack/react-query";
import { Sparkles, DollarSign, Clock } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";

interface UsageRow {
  id: string;
  purpose: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  cost_usd: number;
  request_ms: number | null;
  error: string | null;
  created_at: string;
}

type Window = "7d" | "30d" | "all";

/** J1: the interactive + background agent logs its model calls under
 * `agent:`-prefixed purposes ("agent:turn", "agent:compact_thread"). Treat
 * every such row as agent spend so the usage view can call it out distinctly
 * (A2 made these rows exist; this surfaces them). */
const isAgentPurpose = (purpose: string) => purpose.startsWith("agent:");

function windowSinceIso(w: Window): string | null {
  if (w === "all") return null;
  const days = w === "7d" ? 7 : 30;
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

export function UsageView() {
  const [window, setWindow] = useState<Window>("7d");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["ai-usage", window],
    queryFn: async (): Promise<UsageRow[]> => {
      const sb = createSupabaseBrowserClient();
      const since = windowSinceIso(window);
      const q = sb
        .from("ai_usage_log")
        .select(
          "id, purpose, model, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, cost_usd, request_ms, error, created_at"
        )
        .order("created_at", { ascending: false })
        .limit(2000);
      const { data, error } = since ? await q.gte("created_at", since) : await q;
      if (error) throw error;
      return (data ?? []) as UsageRow[];
    },
    staleTime: 30_000,
  });

  const totals = useMemo(() => {
    let cost = 0;
    let calls = 0;
    let inTok = 0;
    let outTok = 0;
    // J1: agent spend, broken out from the total.
    let agentCost = 0;
    let agentCalls = 0;
    for (const r of rows) {
      const c = Number(r.cost_usd) || 0;
      cost += c;
      calls++;
      inTok += r.input_tokens || 0;
      outTok += r.output_tokens || 0;
      if (isAgentPurpose(r.purpose)) {
        agentCost += c;
        agentCalls++;
      }
    }
    return { cost, calls, inTok, outTok, agentCost, agentCalls };
  }, [rows]);

  const byPurpose = useMemo(() => {
    const map = new Map<
      string,
      { calls: number; cost: number; inTok: number; outTok: number }
    >();
    for (const r of rows) {
      const cur = map.get(r.purpose) ?? { calls: 0, cost: 0, inTok: 0, outTok: 0 };
      cur.calls++;
      cur.cost += Number(r.cost_usd) || 0;
      cur.inTok += r.input_tokens || 0;
      cur.outTok += r.output_tokens || 0;
      map.set(r.purpose, cur);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].cost - a[1].cost);
  }, [rows]);

  const byModel = useMemo(() => {
    const map = new Map<string, { calls: number; cost: number }>();
    for (const r of rows) {
      const cur = map.get(r.model) ?? { calls: 0, cost: 0 };
      cur.calls++;
      cur.cost += Number(r.cost_usd) || 0;
      map.set(r.model, cur);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].cost - a[1].cost);
  }, [rows]);

  const byDay = useMemo(() => {
    const map = new Map<string, { calls: number; cost: number }>();
    for (const r of rows) {
      const day = r.created_at.slice(0, 10);
      const cur = map.get(day) ?? { calls: 0, cost: 0 };
      cur.calls++;
      cur.cost += Number(r.cost_usd) || 0;
      map.set(day, cur);
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [rows]);

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        {(["7d", "30d", "all"] as Window[]).map((w) => (
          <Button
            key={w}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setWindow(w)}
            className={cn(
              "h-7 rounded border px-2.5 text-[11px] font-normal transition-colors",
              window === w
                ? "border-border bg-accent text-foreground hover:bg-accent"
                : "border-border/40 text-muted-foreground hover:bg-accent/30"
            )}
          >
            last {w === "all" ? "all" : w}
          </Button>
        ))}
        <span className="ml-2 font-mono text-[10px] text-muted-foreground">
          {rows.length} calls
        </span>
      </div>

      {/* Headline totals */}
      <Card className="border-l-2 border-l-primary">
        <CardContent className="p-5">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
            <Stat label="cost" value={fmtUsd(totals.cost)} accent />
            <Stat label="calls" value={totals.calls.toLocaleString()} />
            <Stat label="input tokens" value={fmtTok(totals.inTok)} />
            <Stat label="output tokens" value={fmtTok(totals.outTok)} />
            {/* J1: interactive + background agent spend, called out distinctly
                so chat cost is legible against the rest of the AI bill. */}
            <Stat
              label="agent cost"
              value={fmtUsd(totals.agentCost)}
              hint={
                totals.cost > 0
                  ? `${((totals.agentCost / totals.cost) * 100).toFixed(0)}% of total · ${totals.agentCalls.toLocaleString()} calls`
                  : `${totals.agentCalls.toLocaleString()} calls`
              }
            />
            <div className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Sparkles className="h-3 w-3 text-primary" />
              live from ai_usage_log
            </div>
          </div>
        </CardContent>
      </Card>

      {/* By purpose */}
      <section>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          By purpose
        </h3>
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-[12px]">
              <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr className="border-b border-border/40">
                  <th className="px-3 py-2 text-left">Purpose</th>
                  <th className="px-3 py-2 text-right">Calls</th>
                  <th className="px-3 py-2 text-right">Input toks</th>
                  <th className="px-3 py-2 text-right">Output toks</th>
                  <th className="px-3 py-2 text-right">Cost</th>
                  <th className="px-3 py-2 text-right">% of total</th>
                </tr>
              </thead>
              <tbody>
                {byPurpose.map(([purpose, d]) => (
                  <tr key={purpose} className="border-b border-border/30">
                    <td className="px-3 py-2 font-mono">
                      {/* J1: agent rows lead with a sparkle + accent so chat
                          spend stands out among triage / copilot / sync. */}
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5",
                          isAgentPurpose(purpose) && "text-primary"
                        )}
                      >
                        {isAgentPurpose(purpose) && (
                          <Sparkles className="h-3 w-3" />
                        )}
                        {purpose}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                      {d.calls.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                      {fmtTok(d.inTok)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                      {fmtTok(d.outTok)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{fmtUsd(d.cost)}</td>
                    <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                      {totals.cost > 0 ? `${((d.cost / totals.cost) * 100).toFixed(1)}%` : "—"}
                    </td>
                  </tr>
                ))}
                {byPurpose.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                      No calls in this window.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </section>

      {/* By model */}
      <section>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          By model
        </h3>
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-[12px]">
              <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr className="border-b border-border/40">
                  <th className="px-3 py-2 text-left">Model</th>
                  <th className="px-3 py-2 text-right">Calls</th>
                  <th className="px-3 py-2 text-right">Cost</th>
                </tr>
              </thead>
              <tbody>
                {byModel.map(([model, d]) => (
                  <tr key={model} className="border-b border-border/30">
                    <td className="px-3 py-2 font-mono">{model}</td>
                    <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                      {d.calls.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{fmtUsd(d.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </section>

      {/* By day */}
      <section>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          By day
        </h3>
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-[12px]">
              <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr className="border-b border-border/40">
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-right">Calls</th>
                  <th className="px-3 py-2 text-right">Cost</th>
                </tr>
              </thead>
              <tbody>
                {byDay.map(([day, d]) => (
                  <tr key={day} className="border-b border-border/30">
                    <td className="px-3 py-2 font-mono">{day}</td>
                    <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                      {d.calls.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{fmtUsd(d.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </section>

      {/* Recent errors */}
      {rows.some((r) => r.error) && (
        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-destructive">
            Recent errors
          </h3>
          <Card className="border-destructive/30">
            <CardContent className="p-0">
              <ul className="divide-y divide-border/40 text-[12px]">
                {rows
                  .filter((r) => r.error)
                  .slice(0, 20)
                  .map((r) => (
                    <li key={r.id} className="flex items-start gap-3 px-3 py-2">
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {new Date(r.created_at).toLocaleString()}
                      </span>
                      <span className="font-mono text-[10px]">{r.purpose}</span>
                      <span className="flex-1 text-destructive">{r.error}</span>
                    </li>
                  ))}
              </ul>
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
  hint,
}: {
  label: string;
  value: string;
  accent?: boolean;
  hint?: string;
}) {
  return (
    <div>
      <div
        className={cn(
          "font-mono text-2xl tracking-tight",
          accent ? "text-primary" : "text-foreground/90"
        )}
      >
        {value}
      </div>
      <div className="mt-0.5 flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        {label === "cost" && <DollarSign className="h-2.5 w-2.5" />}
        {label === "calls" && <Clock className="h-2.5 w-2.5" />}
        {label === "agent cost" && <Sparkles className="h-2.5 w-2.5" />}
        {label}
      </div>
      {hint && (
        <div className="mt-0.5 text-[10px] normal-case tracking-normal text-muted-foreground/80">
          {hint}
        </div>
      )}
    </div>
  );
}

function fmtUsd(n: number): string {
  if (n === 0) return "$0";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

function fmtTok(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}
