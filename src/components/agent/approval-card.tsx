"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, Pencil, X } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export interface PendingApproval {
  id: string;
  name: string;
  args: Record<string, unknown>;
  expiresAt: string;
}

interface Props {
  approval: PendingApproval;
  /** Base endpoint, e.g. `/api/agent/threads/abc-123` (item-bound) or
   * `/api/agent/threads/by-id/xyz-789` (orphan). The card POSTs to
   * `${base}/approvals/${id}`. */
  base: string;
  /** Fired after a decision is recorded, regardless of outcome. The
   * parent removes the card from the live list; the actual continuation
   * arrives through the SSE stream as a tool_call_result for the same
   * call id. */
  onResolved?: () => void;
}

/**
 * Inline approval card for ring-3 (write_world) agent tool calls.
 *
 * Three actions: Approve, Edit, Cancel.
 *  - Approve: POSTs decision=approve. Loop fires the call as-is.
 *  - Edit:   expands to an editable form over the call's string args.
 *            POSTs decision=edit with `edited_args`. Loop returns a
 *            synthetic { edited: true } result to the model, which
 *            re-issues the tool with the edits (triggering a fresh
 *            approval card for the revised args).
 *  - Cancel: POSTs decision=cancel. Loop returns a synthetic error.
 *
 * Doctrine notes:
 *   - shadcn Button / Input / Textarea only.
 *   - Sanctioned translucency: amber-500/15 + /40 borders (same scale
 *     as the undo strip — these are paired UX surfaces).
 *   - No GSAP, no motion utilities. The card is a "hard pause" — it
 *     should land cleanly, not animate in.
 */
export function ApprovalCard({ approval, base, onResolved }: Props) {
  const [mode, setMode] = useState<"idle" | "editing">("idle");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolved, setResolved] = useState<
    "approved" | "edited" | "cancelled" | "expired" | null
  >(null);

  // Drive a soft expiry timer so the card greys out when the server-
  // side approval row expires.
  const expiresAt = new Date(approval.expiresAt).getTime();
  const [, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (resolved) return;
    const id = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, [resolved]);
  const expired = !resolved && expiresAt < Date.now();
  useEffect(() => {
    if (expired && !resolved) {
      setResolved("expired");
      onResolved?.();
    }
  }, [expired, resolved, onResolved]);

  const editableArgs = useMemo(
    () => normalizeArgs(approval.args),
    [approval.args]
  );
  const [draft, setDraft] = useState<Record<string, string>>(editableArgs);

  async function submit(decision: "approve" | "edit" | "cancel") {
    if (submitting || resolved) return;
    setSubmitting(true);
    setError(null);
    const editedArgs =
      decision === "edit"
        ? mergeEdits(approval.args, draft)
        : undefined;
    try {
      const res = await fetch(`${base}/approvals/${approval.id}`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          decision,
          edited_args: editedArgs,
        }),
      });
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
      } | null;
      if (!res.ok || !body?.ok) {
        setError(body?.error ?? `Couldn't ${decision}.`);
        return;
      }
      setResolved(
        decision === "approve"
          ? "approved"
          : decision === "edit"
            ? "edited"
            : "cancelled"
      );
      onResolved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't reach server.");
    } finally {
      setSubmitting(false);
    }
  }

  if (resolved) {
    return (
      <Alert
        className={cn(
          "block px-2.5 py-1.5 text-[11px] text-muted-foreground",
          resolved === "approved" &&
            "border-emerald-500/40 bg-emerald-500/15",
          resolved === "edited" &&
            "border-amber-500/40 bg-amber-500/15",
          (resolved === "cancelled" || resolved === "expired") &&
            "border-border/40 bg-card/80"
        )}
      >
        <span className="font-mono text-[10px] uppercase tracking-wider">
          {approval.name}
        </span>{" "}
        <span className="text-foreground/80">
          {resolved === "approved" && "approved · firing"}
          {resolved === "edited" && "edited · waiting for model to re-issue"}
          {resolved === "cancelled" && "cancelled"}
          {resolved === "expired" && "approval window expired"}
        </span>
      </Alert>
    );
  }

  return (
    <Alert className="block border-amber-500/40 bg-amber-500/15 px-3 py-2 text-[12px]">
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className="font-mono text-[10px] uppercase tracking-wider text-amber-200">
          approval needed
        </span>
        <span className="font-mono text-[10px] text-foreground/70">
          · {approval.name}
        </span>
      </div>
      {mode === "idle" ? (
        <ArgsPreview args={approval.args} />
      ) : (
        <ArgsEditor
          args={approval.args}
          draft={draft}
          onChange={(key, value) =>
            setDraft((prev) => ({ ...prev, [key]: value }))
          }
        />
      )}
      {error && (
        <div className="mt-1.5 rounded border border-destructive/40 bg-destructive/15 px-2 py-1 text-[11px] text-destructive">
          {error}
        </div>
      )}
      <div className="mt-2 flex items-center gap-1.5">
        {mode === "idle" ? (
          <>
            <Button
              type="button"
              size="sm"
              variant="default"
              onClick={() => submit("approve")}
              disabled={submitting}
              className="mashi-press h-7 gap-1 px-2 text-[11px]"
            >
              {submitting ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Check className="h-3 w-3" />
              )}
              Approve
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setMode("editing")}
              disabled={submitting}
              className="mashi-press h-7 gap-1 px-2 text-[11px]"
            >
              <Pencil className="h-3 w-3" />
              Edit
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => submit("cancel")}
              disabled={submitting}
              className="mashi-press h-7 gap-1 px-2 text-[11px]"
            >
              <X className="h-3 w-3" />
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button
              type="button"
              size="sm"
              variant="default"
              onClick={() => submit("edit")}
              disabled={submitting}
              className="mashi-press h-7 gap-1 px-2 text-[11px]"
            >
              {submitting ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Check className="h-3 w-3" />
              )}
              Save edits
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setMode("idle")}
              disabled={submitting}
              className="mashi-press h-7 px-2 text-[11px]"
            >
              Back
            </Button>
          </>
        )}
      </div>
    </Alert>
  );
}

function ArgsPreview({ args }: { args: Record<string, unknown> }) {
  const entries = Object.entries(args);
  return (
    <div className="space-y-1">
      {entries.map(([key, value]) => (
        <div key={key} className="text-[11px] leading-snug">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {key}:
          </span>{" "}
          <span className="whitespace-pre-wrap text-foreground/85">
            {formatPreview(value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function ArgsEditor({
  args,
  draft,
  onChange,
}: {
  args: Record<string, unknown>;
  draft: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  const entries = Object.entries(args);
  return (
    <div className="space-y-1.5">
      {entries.map(([key, value]) => {
        const editable = isStringish(value);
        if (!editable) {
          return (
            <div
              key={key}
              className="text-[11px] leading-snug text-muted-foreground"
            >
              <span className="font-mono text-[10px] uppercase tracking-wider">
                {key}:
              </span>{" "}
              <span className="italic">non-editable</span>
            </div>
          );
        }
        const isLong = typeof value === "string" && value.length > 80;
        return (
          <div key={key} className="space-y-0.5">
            <label className="block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {key}
            </label>
            {isLong ? (
              <Textarea
                value={draft[key] ?? ""}
                onChange={(e) => onChange(key, e.target.value)}
                rows={Math.min(8, Math.max(3, Math.ceil((draft[key] ?? "").length / 60)))}
                className="text-[12px]"
              />
            ) : (
              <Input
                value={draft[key] ?? ""}
                onChange={(e) => onChange(key, e.target.value)}
                className="h-7 text-[12px]"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function normalizeArgs(args: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(args)) {
    if (isStringish(v)) {
      out[k] = typeof v === "string" ? v : String(v);
    }
  }
  return out;
}

function mergeEdits(
  original: Record<string, unknown>,
  draft: Record<string, string>
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...original };
  for (const [k, v] of Object.entries(draft)) {
    merged[k] = v;
  }
  return merged;
}

function isStringish(value: unknown): boolean {
  return typeof value === "string" || typeof value === "number";
}

function formatPreview(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return JSON.stringify(value, null, 2);
}
