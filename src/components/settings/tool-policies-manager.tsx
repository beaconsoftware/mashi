"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, Trash2, AlertTriangle } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  approvalMetaFor,
  listApprovalToolNames,
} from "@/lib/agent/approval-meta";
import {
  WILDCARD_SCOPE,
  describeScope,
  isAlwaysAllowEligible,
  type PolicyMode,
  type ToolPolicy,
} from "@/lib/agent/policy";

/**
 * Settings surface for the per-tool approval policy (E1).
 *
 *   - "Per-tool defaults" — for every ring-3 tool, a three-way choice of
 *     Ask (default) / Always allow / Never, written against the `*` scope.
 *     Always allow is unavailable for irreversible sends (E5 / privacy
 *     doctrine): an email, Slack post, or Linear comment can never be waved
 *     through automatically.
 *   - "Scoped exceptions" — the narrow rows the inline "always allow this"
 *     affordance writes from the chat (e.g. always-allow react_with_emoji in
 *     one specific channel), each removable here.
 *
 * Doctrine: shadcn Select / Button only; opaque `bg-card` surfaces; sanctioned
 * type + spacing tokens; `.mashi-press` on controls.
 */
export function ToolPoliciesManager() {
  const queryClient = useQueryClient();
  const [err, setErr] = useState<string | null>(null);

  const { data: policies = [], isLoading: loading } = useQuery<ToolPolicy[]>({
    queryKey: ["agent-tool-policies"],
    queryFn: async () => {
      const res = await fetch("/api/agent/tool-policies");
      if (!res.ok) throw new Error("Couldn't load your policies.");
      const j = await res.json();
      return (j.policies ?? []) as ToolPolicy[];
    },
  });

  const reload = () =>
    queryClient.invalidateQueries({ queryKey: ["agent-tool-policies"] });

  const tools = useMemo(() => listApprovalToolNames().sort(), []);

  // Wildcard (default) mode per tool, falling back to "ask".
  const defaultModeFor = (tool: string): PolicyMode =>
    policies.find((p) => p.tool_name === tool && p.scope === WILDCARD_SCOPE)
      ?.mode ?? "ask";

  const scopedExceptions = useMemo(
    () => policies.filter((p) => p.scope !== WILDCARD_SCOPE),
    [policies]
  );

  async function setDefault(tool: string, mode: PolicyMode) {
    setErr(null);
    // "Ask" is the absence of a rule — drop the wildcard row if one exists.
    if (mode === "ask") {
      const existing = policies.find(
        (p) => p.tool_name === tool && p.scope === WILDCARD_SCOPE
      );
      if (existing?.id) await removeById(existing.id);
      else void reload();
      return;
    }
    const res = await fetch("/api/agent/tool-policies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool_name: tool, scope: WILDCARD_SCOPE, mode }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      setErr(j?.error ?? "Couldn't save that policy.");
    }
    void reload();
  }

  async function removeById(id: string) {
    setErr(null);
    await fetch("/api/agent/tool-policies", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    void reload();
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <header className="space-y-1">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Approval policy</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Decide which world-changing actions Mashi can take without stopping
          for your approval each time. Irreversible sends (email, Slack
          messages, Linear comments) always ask, by design, they can&apos;t be
          set to always-allow.
        </p>
      </header>

      {err && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{err}</span>
        </div>
      )}

      <section className="rounded-lg border border-border/40 bg-card">
        <div className="border-b border-border/30 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Per-tool defaults
        </div>
        {loading ? (
          <div className="px-4 py-6 text-center text-xs text-muted-foreground">
            Loading…
          </div>
        ) : (
          <ul className="divide-y divide-border/30">
            {tools.map((tool) => {
              const meta = approvalMetaFor(tool);
              const eligible = isAlwaysAllowEligible(tool);
              const mode = defaultModeFor(tool);
              return (
                <li
                  key={tool}
                  className="mashi-magnetic flex items-center gap-3 px-4 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium">
                      {meta.verb} {meta.noun}
                    </div>
                    <code className="text-[11px] text-muted-foreground">
                      {tool}
                    </code>
                  </div>
                  <Select
                    value={mode}
                    onValueChange={(v) => setDefault(tool, v as PolicyMode)}
                  >
                    <SelectTrigger className="mashi-press h-8 w-36 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ask">Ask each time</SelectItem>
                      <SelectItem value="always_allow" disabled={!eligible}>
                        Always allow
                      </SelectItem>
                      <SelectItem value="never">Never</SelectItem>
                    </SelectContent>
                  </Select>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {scopedExceptions.length > 0 && (
        <section className="rounded-lg border border-border/40 bg-card">
          <div className="border-b border-border/30 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Scoped exceptions
          </div>
          <ul className="divide-y divide-border/30">
            {scopedExceptions.map((p) => {
              const meta = approvalMetaFor(p.tool_name);
              return (
                <li
                  key={p.id ?? `${p.tool_name}:${p.scope}`}
                  className="flex items-center gap-3 px-4 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium">
                      {meta.verb} {meta.noun}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      <span className={cn(modeTone(p.mode))}>
                        {MODE_LABEL[p.mode]}
                      </span>{" "}
                      · {describeScope(p.scope)}
                    </div>
                  </div>
                  {p.id && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeById(p.id!)}
                      aria-label="Remove exception"
                      title="Remove exception"
                      className="mashi-press h-6 w-6 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

const MODE_LABEL: Record<PolicyMode, string> = {
  always_allow: "Always allow",
  ask: "Ask each time",
  never: "Never",
};

function modeTone(mode: PolicyMode): string {
  if (mode === "always_allow") return "text-emerald-400";
  if (mode === "never") return "text-rose-400";
  return "text-foreground/80";
}
