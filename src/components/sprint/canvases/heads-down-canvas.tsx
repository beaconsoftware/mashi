"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, Sparkles, Copy, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { CanvasShell, type CanvasBaseProps } from "./_shared/canvas-shell";
import { useEnrichedContext } from "@/hooks/use-enriched-context";
import { useSpawnedRail } from "@/store/spawned-rail-store";

/**
 * HeadsDownCanvas — serves heads_down.
 *
 * The user will leave Mashi to do the actual work in another tool
 * (Claude Desktop, Claude Code, an IDE, a doc). The canvas is the
 * launchpad + the receiving dock for the outcome:
 *
 *   • Top half: 3-step plan with checkboxes
 *   • Middle:   Open in Claude Desktop · Copy prompt
 *   • Bottom:   "What did you produce?" outcome textarea
 *
 * Pre-warm writes both `enriched_context.heads_down_plan.steps` and
 * `.handoffPrompt`. Done fires `onExit({ kind: "done", outcome })` —
 * outcome is the textarea contents. If the textarea is empty we still
 * exit but the SlotCard treats it like the regular "Done" path.
 */

interface PlanStep {
  id: string;
  text: string;
  checked: boolean;
}

interface StoredHeadsDownPlan {
  steps?: PlanStep[];
  handoffPrompt?: string;
}

export function HeadsDownCanvas({
  item,
  active,
  prewarm,
  onExit,
  onOpenDetail,
}: CanvasBaseProps) {
  const enrich = useEnrichedContext(item.id, { polling: prewarm.status === "warming" });
  const stored = readPlan(enrich.data?.enriched_context);
  const [steps, setSteps] = useState<PlanStep[]>(() => stored?.steps ?? []);
  const [handoff, setHandoff] = useState<string>(stored?.handoffPrompt ?? "");
  const [outcome, setOutcome] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const pushArtifact = useSpawnedRail((s) => s.push);

  // Reset / hydrate when the slot promotes a different item.
  useEffect(() => {
    const next = readPlan(enrich.data?.enriched_context);
    setSteps(next?.steps ?? []);
    setHandoff(next?.handoffPrompt ?? "");
    setOutcome("");
    setError(null);
    setCopied(false);
  }, [item.id, enrich.data?.enriched_context]);

  const hasPlan = steps.length > 0;
  const completedCount = useMemo(
    () => steps.filter((s) => s.checked).length,
    [steps]
  );

  function toggleStep(stepId: string) {
    setSteps((s) =>
      s.map((step) =>
        step.id === stepId ? { ...step, checked: !step.checked } : step
      )
    );
  }

  async function buildPlan() {
    if (generating) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/s2d/${item.id}/heads-down/plan`, {
        method: "POST",
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(t || `plan failed (${res.status})`);
      }
      await enrich.refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : "plan failed");
    } finally {
      setGenerating(false);
    }
  }

  async function copyHandoff() {
    if (!handoff.trim()) return;
    try {
      await navigator.clipboard.writeText(handoff);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Couldn't write to clipboard");
    }
  }

  async function openInClaudeDesktop() {
    // Copy first so the deep link landing in a fresh Claude Desktop
    // window can be populated by paste. The desktop scheme accepts no
    // payload today; copy + open is the canonical pattern.
    await copyHandoff();
    window.open("claude-desktop://", "_self");
  }

  async function complete() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const trimmed = outcome.trim();
      if (trimmed) {
        pushArtifact({
          kind: "sent",
          itemId: item.id,
          label: "Heads-down outcome",
          detail:
            trimmed.length > 140 ? `${trimmed.slice(0, 137)}…` : trimmed,
        });
      }
      await onExit({ kind: "done", outcome: trimmed || undefined });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <CanvasShell
      item={item}
      active={active}
      prewarm={prewarm}
      onExit={onExit}
      onOpenDetail={onOpenDetail}
      footerVariant="compact"
      primary={
        <Button
          type="button"
          size="sm"
          onClick={complete}
          disabled={submitting}
          className="mashi-press h-7 gap-1.5 px-3 text-[11px]"
          title="Mark this heads-down block done"
        >
          {submitting ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Check className="h-3 w-3" />
          )}
          {submitting ? "Closing" : "Done"}
        </Button>
      }
    >
      <div className="space-y-3">
        <section className="rounded-md border border-border/40 bg-card/60 p-2.5">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Plan
              {hasPlan && (
                <span className="ml-1 normal-case tracking-normal text-muted-foreground/70">
                  · {completedCount}/{steps.length}
                </span>
              )}
            </span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={buildPlan}
              disabled={generating}
              className="mashi-press h-6 gap-1 px-2 text-[11px]"
              title="Generate (or regenerate) a 3-step plan + handoff prompt"
            >
              {generating ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="h-3 w-3" />
              )}
              {generating
                ? "Building"
                : hasPlan
                  ? "Regenerate"
                  : "Build plan"}
            </Button>
          </div>
          {!hasPlan && !generating && (
            <p className="rounded border border-dashed border-border/40 bg-card/55 p-3 text-[11px] text-muted-foreground">
              {prewarm.status === "warming"
                ? "Pre-warming a 3-step plan — it should land in a moment."
                : "Build a plan to set up the focus block. The handoff prompt below feeds Claude Desktop / Claude Code."}
            </p>
          )}
          {hasPlan && (
            <ol className="space-y-1.5">
              {steps.map((step, i) => (
                <li
                  key={step.id}
                  className={cn(
                    "flex items-start gap-2 rounded border border-border/30 bg-card/60 px-2 py-1.5 text-[11px] leading-snug",
                    step.checked && "opacity-60"
                  )}
                >
                  <Checkbox
                    checked={step.checked}
                    onCheckedChange={() => toggleStep(step.id)}
                    className="mt-0.5"
                    aria-label={`Step ${i + 1}`}
                  />
                  <span className="font-mono text-[10px] text-primary">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span
                    className={cn(
                      "flex-1",
                      step.checked
                        ? "text-muted-foreground line-through"
                        : "text-foreground/95"
                    )}
                  >
                    {step.text}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        {handoff.trim() && (
          <section className="rounded-md border border-border/40 bg-card/60 p-2.5">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Handoff prompt
              </span>
              <div className="flex gap-1">
                <Button
                  type="button"
                  size="sm"
                  onClick={openInClaudeDesktop}
                  className="mashi-press h-6 gap-1 px-2 text-[11px]"
                  title="Copy the handoff prompt and open Claude Desktop"
                >
                  <ExternalLink className="h-3 w-3" />
                  Open Claude Desktop
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={copyHandoff}
                  className="mashi-press h-6 gap-1 px-2 text-[11px]"
                  title="Copy the handoff prompt to the clipboard"
                >
                  <Copy className="h-3 w-3" />
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            </div>
            <Textarea
              value={handoff}
              onChange={(e) => setHandoff(e.target.value)}
              rows={6}
              className="resize-none rounded border-border/40 bg-card/80 px-2 py-1.5 text-[11px] leading-snug"
            />
          </section>
        )}

        <section className="rounded-md border border-border/40 bg-card/60 p-2.5">
          <div className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            What did you produce?
          </div>
          <Textarea
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            rows={4}
            placeholder="One line on what you got done — surfaces in the sprint recap."
            className="resize-none rounded border-border/40 bg-card/80 px-2 py-1.5 text-[11px] leading-snug placeholder:text-muted-foreground/60"
          />
        </section>

        {error && <div className="text-[11px] text-destructive">{error}</div>}
      </div>
    </CanvasShell>
  );
}

function readPlan(ctx: unknown): StoredHeadsDownPlan | null {
  if (!ctx || typeof ctx !== "object") return null;
  const candidate = (ctx as { heads_down_plan?: StoredHeadsDownPlan })
    .heads_down_plan;
  if (!candidate || typeof candidate !== "object") return null;
  const steps = Array.isArray(candidate.steps)
    ? candidate.steps.filter(
        (s): s is PlanStep =>
          typeof s === "object" &&
          s !== null &&
          typeof (s as PlanStep).id === "string" &&
          typeof (s as PlanStep).text === "string"
      )
    : [];
  const handoffPrompt =
    typeof candidate.handoffPrompt === "string" ? candidate.handoffPrompt : "";
  if (steps.length === 0 && !handoffPrompt.trim()) return null;
  return { steps, handoffPrompt };
}
