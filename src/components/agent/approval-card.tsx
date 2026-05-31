"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Check,
  FileText,
  Loader2,
  Pencil,
  PencilLine,
  Send,
  X,
} from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  applyEdits,
  approvalMetaFor,
  buildDiffRows,
  flattenEditable,
  formatValue,
  isLongField,
  isPolicyControlled,
  type ApprovalContext,
  type ApprovalMeta,
  type DiffRow,
  type EditableLeaf,
} from "@/lib/agent/approval-meta";
import { isAlwaysAllowEligible, rememberScopeLabel } from "@/lib/agent/policy";

export interface PendingApproval {
  id: string;
  name: string;
  args: Record<string, unknown>;
  expiresAt: string;
  /** E2: optional before-snapshot ({ before: {...} }) the card diffs against
   * the proposed patch for update-type tools. */
  context?: unknown;
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
 * Inline approval card for ring-3 (write_world) agent tool calls, plus opt-in
 * ring-2 confirms (F1: `propose_memory` renders here as a light card).
 *
 * P4.a (E2 + E3) gave this card weight and fidelity:
 *  - It reads the action's weight (`approvalMetaFor`): an irreversible SEND
 *    gets a destructive-style primary + `.mashi-glow-focus`; a reversible
 *    draft / reaction reads light; an external create / update sits between.
 *    The header says what will happen ("Send · email — goes out now, can't
 *    be recalled") instead of a generic "approval needed".
 *  - For update tools it renders a before/after DIFF over the patched fields,
 *    from the before-snapshot the tool's `approvalContext` shipped (E2).
 *  - Edit mode flattens nested object / array args into editable leaves
 *    (`flattenEditable` / `applyEdits`), so a `patch.title` or an
 *    `attendees.0` is editable rather than dropped as "non-editable", and
 *    long bodies edit in a multi-line Textarea.
 *
 * Three actions: Approve (label varies by action), Edit, Cancel.
 *  - Approve: POSTs decision=approve. Loop fires the call as-is.
 *  - Edit:   POSTs decision=edit with `edited_args`. Loop returns a synthetic
 *            { edited: true } result; the model re-issues with the edits
 *            (triggering a fresh approval for the revised args).
 *  - Cancel: POSTs decision=cancel. Loop returns a synthetic, neutrally-
 *            rendered "cancelled" result (not an error).
 *
 * Doctrine notes:
 *   - shadcn Button / Input / Textarea / Alert only.
 *   - Sanctioned translucency steps only (/15, /40, /80).
 *   - The card is a "hard pause" — `.mashi-press` on the controls, plus
 *     `.mashi-glow-focus` on the send primary; no entry animation.
 */
export function ApprovalCard({ approval, base, onResolved }: Props) {
  const meta = useMemo(() => approvalMetaFor(approval.name), [approval.name]);
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

  const leaves = useMemo(
    () => flattenEditable(approval.args),
    [approval.args]
  );
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(leaves.map((l) => [l.key, l.value]))
  );

  // E1: inline "always allow" — eligible for everything except irreversible
  // sends (an email / Slack post / Linear comment is never waved through), and
  // only for policy-controlled tools (F1: a propose_memory confirm is never
  // policy-bypassable, so it shows no toggle).
  const canRemember = useMemo(
    () =>
      isAlwaysAllowEligible(approval.name) &&
      isPolicyControlled(approval.name),
    [approval.name]
  );
  const rememberSuffix = useMemo(
    () => rememberScopeLabel(approval.name, approval.args),
    [approval.name, approval.args]
  );
  const [remember, setRemember] = useState(false);

  // E2: before/after diff rows for update tools that shipped a snapshot.
  const diffRows = useMemo<DiffRow[] | null>(() => {
    if (!meta.isUpdate) return null;
    const before = (approval.context as ApprovalContext | undefined)?.before;
    const patch = approval.args.patch;
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
      return null;
    }
    return buildDiffRows(before, patch as Record<string, unknown>);
  }, [meta.isUpdate, approval.context, approval.args]);

  async function submit(decision: "approve" | "edit" | "cancel") {
    if (submitting || resolved) return;
    setSubmitting(true);
    setError(null);
    const editedArgs =
      decision === "edit"
        ? applyEdits(approval.args, draft, leaves)
        : undefined;
    try {
      const res = await fetch(`${base}/approvals/${approval.id}`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          decision,
          edited_args: editedArgs,
          remember: decision === "approve" && canRemember ? remember : undefined,
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
          resolved === "edited" && "border-amber-500/40 bg-amber-500/15",
          (resolved === "cancelled" || resolved === "expired") &&
            "border-border/40 bg-card/80"
        )}
      >
        <span className="font-mono text-[10px] uppercase tracking-wider">
          {meta.verb}
        </span>{" "}
        <span className="text-foreground/80">
          {resolved === "approved" &&
            (meta.reversible ? "done" : "approved · firing")}
          {resolved === "edited" && "edited · waiting for model to re-issue"}
          {resolved === "cancelled" && "cancelled"}
          {resolved === "expired" && "approval window expired"}
        </span>
      </Alert>
    );
  }

  const tone = TONE[meta.weight];

  return (
    <Alert className={cn("block px-3 py-2 text-xs", tone.root)}>
      <div className="mb-1.5 flex items-start gap-2">
        <tone.Icon className={cn("mt-0.5 size-3.5 shrink-0", tone.icon)} />
        <div className="min-w-0">
          <div className="flex items-baseline gap-1.5">
            <span className={cn("text-[11px] font-semibold", tone.title)}>
              {meta.verb} {meta.noun}
            </span>
            <span className="font-mono text-[10px] text-foreground/60">
              · {approval.name}
            </span>
          </div>
          <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
            {meta.consequence}
          </p>
        </div>
      </div>

      {mode === "idle" ? (
        diffRows ? (
          <DiffView rows={diffRows} />
        ) : (
          <ArgsPreview args={approval.args} />
        )
      ) : (
        <ArgsEditor
          leaves={leaves}
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

      {mode === "idle" && canRemember && (
        <label className="mt-2 flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
          <Checkbox
            checked={remember}
            onCheckedChange={(v) => setRemember(v === true)}
            disabled={submitting}
            className="size-3.5"
          />
          <span>
            Always allow {meta.verb.toLowerCase()} {meta.noun}
            {rememberSuffix} — skip this card next time
          </span>
        </label>
      )}

      <div className="mt-2 flex items-center gap-1.5">
        {mode === "idle" ? (
          <>
            <Button
              type="button"
              size="sm"
              variant={meta.weight === "send" ? "destructive" : "default"}
              onClick={() => submit("approve")}
              disabled={submitting}
              // L2: the thread's one-key approve (⌘/Ctrl+Enter) and arrow
              // roving find this control by attribute and click it, so the
              // approval logic stays in one place.
              data-thread-action="approve"
              className={cn(
                "mashi-press h-7 gap-1 px-2 text-[11px]",
                meta.weight === "send" && "mashi-glow-focus"
              )}
            >
              {submitting ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Check className="h-3 w-3" />
              )}
              {meta.primaryLabel}
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

/** Weight → colour + icon. Sends read as a weighty, irreversible gesture; a
 * reversible draft reads light. Only sanctioned /15 + /40 + /80 steps. */
const TONE: Record<
  ApprovalMeta["weight"],
  {
    root: string;
    icon: string;
    title: string;
    Icon: typeof Send;
  }
> = {
  send: {
    root: "border-rose-500/40 bg-rose-500/15",
    icon: "text-rose-400",
    title: "text-rose-200",
    Icon: Send,
  },
  external: {
    root: "border-amber-500/40 bg-amber-500/15",
    icon: "text-amber-400",
    title: "text-amber-200",
    Icon: PencilLine,
  },
  reversible: {
    root: "border-border/40 bg-card/80",
    icon: "text-muted-foreground",
    title: "text-foreground",
    Icon: FileText,
  },
};

/** E2: before/after rows for an update. Unchanged fields read muted; changed
 * fields strike the old value and arrow to the new. */
function DiffView({ rows }: { rows: DiffRow[] }) {
  return (
    <div className="space-y-1.5">
      {rows.map((row) => (
        <div key={row.field} className="text-[11px] leading-snug">
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {row.field}
          </div>
          {row.changed ? (
            <div className="flex flex-wrap items-baseline gap-1">
              {row.before ? (
                <span className="text-muted-foreground line-through">
                  {row.before}
                </span>
              ) : (
                <span className="italic text-muted-foreground">(empty)</span>
              )}
              <ArrowRight className="size-2.5 shrink-0 text-muted-foreground" />
              <span className="whitespace-pre-wrap font-medium text-foreground">
                {row.after}
              </span>
            </div>
          ) : (
            <span className="whitespace-pre-wrap text-foreground/70">
              {row.after}{" "}
              <span className="text-[10px] text-muted-foreground">
                (unchanged)
              </span>
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function ArgsPreview({ args }: { args: Record<string, unknown> }) {
  const entries = Object.entries(args);
  return (
    <div className="space-y-1.5">
      {entries.map(([key, value]) => {
        // Long-form fields (email body, message text, description) read as a
        // bordered block so a real message is legible, not crammed inline.
        const long =
          isLongField(key) ||
          (typeof value === "string" && value.length > 80);
        if (long) {
          return (
            <div key={key} className="space-y-0.5">
              <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {key}
              </div>
              <div className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded border border-border/40 bg-card/80 px-2 py-1 text-[11px] text-foreground/90">
                {formatValue(value)}
              </div>
            </div>
          );
        }
        return (
          <div key={key} className="text-[11px] leading-snug">
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {key}:
            </span>{" "}
            <span className="whitespace-pre-wrap break-words text-foreground/85">
              {formatValue(value)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ArgsEditor({
  leaves,
  draft,
  onChange,
}: {
  leaves: EditableLeaf[];
  draft: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  if (leaves.length === 0) {
    return (
      <p className="text-[11px] italic text-muted-foreground">
        Nothing editable in this call.
      </p>
    );
  }
  return (
    <div className="space-y-1.5">
      {leaves.map((leaf) => (
        <div key={leaf.key} className="space-y-0.5">
          <label className="block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {leaf.label}
          </label>
          {leaf.kind === "long" ? (
            <Textarea
              value={draft[leaf.key] ?? ""}
              onChange={(e) => onChange(leaf.key, e.target.value)}
              rows={Math.min(
                10,
                Math.max(3, Math.ceil((draft[leaf.key] ?? "").length / 60))
              )}
              className="text-xs"
            />
          ) : (
            <Input
              value={draft[leaf.key] ?? ""}
              onChange={(e) => onChange(leaf.key, e.target.value)}
              className="h-7 text-xs"
            />
          )}
        </div>
      ))}
    </div>
  );
}
