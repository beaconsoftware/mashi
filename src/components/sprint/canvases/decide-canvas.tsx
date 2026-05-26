"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { CanvasShell, type CanvasBaseProps } from "./_shared/canvas-shell";
import { useEnrichedContext, type EnrichSourceKind } from "@/hooks/use-enriched-context";
import { useSpawnedRail } from "@/store/spawned-rail-store";

/**
 * DecideCanvas — serves decision_gate.
 *
 * 2x2 grid of choice cards (Yes / Yes-but / No / Defer). Each carries
 * its own note textarea; Yes-but adds a `condition` field; Defer adds
 * a date + trigger. The bottom "What you know" strip shows decision-
 * relevant sources from the enriched context.
 *
 * On commit, POSTs the full DecisionLog to /api/s2d/{id}/decision and
 * lets the parent close the slot via onExit. For Yes-but, the server
 * also spawns the follow-up s2d_item and returns its id so we can push
 * both a "decision" and a "follow-up" artifact onto the spawned rail.
 */

type Choice = "yes" | "yes-but" | "no" | "defer";

interface DecisionBriefStored {
  yes?: { whyBullets?: string[]; preParadeLine?: string };
  no?: { whyBullets?: string[]; preMortemLine?: string };
  yesBut?: { conditions?: string[] };
  defer?: { triggerCandidates?: string[] };
}

const CHOICE_META: Record<
  Choice,
  { label: string; glyph: string; tone: "primary" | "accent" | "muted" | "warn" }
> = {
  yes: { label: "Yes", glyph: "✓", tone: "primary" },
  "yes-but": { label: "Yes, but…", glyph: "≈", tone: "accent" },
  no: { label: "No", glyph: "✕", tone: "warn" },
  defer: { label: "Defer", glyph: "⏳", tone: "muted" },
};

export function DecideCanvas({
  item,
  active,
  prewarm,
  onExit,
  onOpenDetail,
}: CanvasBaseProps) {
  const enrich = useEnrichedContext(item.id, { polling: prewarm.status === "warming" });
  const ctx = enrich.data?.enriched_context;
  const brief = readDecisionBrief(ctx);
  const cited = (ctx?.pulled_sources ?? []).slice(0, 5);

  const [selected, setSelected] = useState<Choice | null>(null);
  const [notes, setNotes] = useState<Record<Choice, string>>({
    yes: "",
    "yes-but": "",
    no: "",
    defer: "",
  });
  const [condition, setCondition] = useState("");
  const [deferUntil, setDeferUntil] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  });
  const [deferTrigger, setDeferTrigger] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [briefing, setBriefing] = useState(false);
  const pushArtifact = useSpawnedRail((s) => s.push);

  useEffect(() => {
    setSelected(null);
    setNotes({ yes: "", "yes-but": "", no: "", defer: "" });
    setCondition("");
    setDeferTrigger("");
    setError(null);
  }, [item.id]);

  const hasBrief = !!brief;

  async function buildBrief() {
    if (briefing) return;
    setBriefing(true);
    setError(null);
    try {
      const res = await fetch(`/api/s2d/${item.id}/decision/brief`, {
        method: "POST",
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(t || `brief failed (${res.status})`);
      }
      await enrich.refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : "brief failed");
    } finally {
      setBriefing(false);
    }
  }

  async function commit() {
    if (!selected || saving) return;
    const note = notes[selected].trim();
    if (!note) {
      setError("Add a one-line rationale before deciding.");
      return;
    }
    if (selected === "yes-but" && !condition.trim()) {
      setError("Yes-but needs a condition to track.");
      return;
    }
    if (selected === "defer" && !deferUntil) {
      setError("Defer needs a date.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        choice: selected,
        note,
        condition: selected === "yes-but" ? condition.trim() : undefined,
        deferUntil: selected === "defer" ? deferUntil : undefined,
        deferTrigger:
          selected === "defer" && deferTrigger.trim()
            ? deferTrigger.trim()
            : undefined,
        sourcesCited: cited.map((s) => ({
          kind: s.kind,
          ref: s.ref,
          label: s.label,
        })),
      };
      const res = await fetch(`/api/s2d/${item.id}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = (await res.json()) as {
        ok?: boolean;
        error?: string;
        followUpItemId?: string;
      };
      if (!res.ok || !j.ok) {
        setError(j.error ?? `decide failed (${res.status})`);
        return;
      }
      pushArtifact({
        kind: "decision",
        itemId: item.id,
        label: `Decided ${CHOICE_META[selected].label}`,
        detail: note.length > 140 ? `${note.slice(0, 137)}…` : note,
      });
      if (j.followUpItemId) {
        pushArtifact({
          kind: "follow-up",
          itemId: item.id,
          spawnedItemId: j.followUpItemId,
          label: "Follow-up spawned",
          detail: condition.trim() || "Yes-but condition",
        });
      }
      await onExit({
        kind: "decide",
        choice: selected,
        note,
        condition: selected === "yes-but" ? condition.trim() : undefined,
        deferUntil: selected === "defer" ? deferUntil : undefined,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "decide failed");
    } finally {
      setSaving(false);
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
        <div className="flex items-center gap-2">
          {!hasBrief && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={buildBrief}
              disabled={briefing}
              className="mashi-press h-7 gap-1.5 px-2 text-[11px]"
              title="Generate a 4-option brief — costs ~$0.05"
            >
              {briefing ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="h-3 w-3" />
              )}
              {briefing ? "Building" : "Build brief"}
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            onClick={commit}
            disabled={!selected || saving}
            className="mashi-press h-7 gap-1.5 px-3 text-[11px]"
          >
            {saving ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Check className="h-3 w-3" />
            )}
            {saving
              ? "Recording"
              : selected
                ? `Decide · ${CHOICE_META[selected].label}`
                : "Pick a card"}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <section>
          <h4 className="mb-1 text-balance text-[13px] font-semibold leading-snug text-foreground">
            {item.title}
          </h4>
          {item.description && (
            <p className="text-[11px] leading-snug text-muted-foreground">
              {item.description}
            </p>
          )}
        </section>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(Object.keys(CHOICE_META) as Choice[]).map((c) => (
            <ChoiceCard
              key={c}
              choice={c}
              selected={selected === c}
              onSelect={() => setSelected(c)}
              note={notes[c]}
              onNoteChange={(v) => setNotes((n) => ({ ...n, [c]: v }))}
              brief={brief}
              condition={condition}
              onConditionChange={setCondition}
              deferUntil={deferUntil}
              onDeferUntilChange={setDeferUntil}
              deferTrigger={deferTrigger}
              onDeferTriggerChange={setDeferTrigger}
            />
          ))}
        </div>

        <section className="rounded-md border border-border/40 bg-card/55 p-2.5">
          <div className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            What you know
            {cited.length > 0 && (
              <span className="normal-case tracking-normal text-muted-foreground/70">
                {" "}
                · {cited.length} source{cited.length === 1 ? "" : "s"} cited
              </span>
            )}
          </div>
          {cited.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">
              Run Enrich (from Refine) to surface decision-relevant snippets here.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {cited.map((s) => (
                <li
                  key={`${s.kind}:${s.ref}`}
                  className="rounded border border-border/30 bg-card/60 px-2 py-1.5 text-[11px]"
                >
                  <div className="font-medium text-foreground/90">{s.label}</div>
                  {s.snippet && (
                    <div className="mt-0.5 line-clamp-2 text-muted-foreground">
                      {s.snippet}
                    </div>
                  )}
                  <div className="mt-0.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">
                    {labelKind(s.kind)}
                    {s.when ? ` · ${s.when.slice(0, 10)}` : ""}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {error && <div className="text-[11px] text-destructive">{error}</div>}
      </div>
    </CanvasShell>
  );
}

function ChoiceCard({
  choice,
  selected,
  onSelect,
  note,
  onNoteChange,
  brief,
  condition,
  onConditionChange,
  deferUntil,
  onDeferUntilChange,
  deferTrigger,
  onDeferTriggerChange,
}: {
  choice: Choice;
  selected: boolean;
  onSelect: () => void;
  note: string;
  onNoteChange: (v: string) => void;
  brief: DecisionBriefStored | null;
  condition: string;
  onConditionChange: (v: string) => void;
  deferUntil: string;
  onDeferUntilChange: (v: string) => void;
  deferTrigger: string;
  onDeferTriggerChange: (v: string) => void;
}) {
  const meta = CHOICE_META[choice];
  const bullets = bulletsForChoice(choice, brief);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      aria-pressed={selected}
      className={cn(
        "mashi-magnetic flex flex-col gap-1.5 rounded-md border p-2.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected
          ? "border-primary/60 bg-primary/15"
          : "border-border/40 bg-card/55 hover:border-border/60 hover:bg-card/80"
      )}
    >
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider">
        <span aria-hidden className="text-base leading-none">
          {meta.glyph}
        </span>
        {meta.label}
      </div>
      {bullets.length > 0 && (
        <ul className="space-y-0.5 text-[11px] leading-snug text-muted-foreground">
          {bullets.slice(0, 3).map((b, i) => (
            <li key={i}>· {b}</li>
          ))}
        </ul>
      )}
      <Textarea
        value={note}
        onChange={(e) => {
          e.stopPropagation();
          onNoteChange(e.target.value);
        }}
        onClick={(e) => e.stopPropagation()}
        rows={2}
        placeholder={
          choice === "yes"
            ? "Why yes?"
            : choice === "no"
              ? "Why no?"
              : choice === "yes-but"
                ? "Yes — and what's the condition?"
                : "Deferring until what unblocks?"
        }
        className="resize-none rounded border-border/40 bg-card/80 px-2 py-1.5 text-[11px] leading-snug placeholder:text-muted-foreground/60"
      />
      {choice === "yes-but" && (
        <Input
          value={condition}
          onChange={(e) => {
            e.stopPropagation();
            onConditionChange(e.target.value);
          }}
          onClick={(e) => e.stopPropagation()}
          placeholder="Condition (becomes the follow-up item)"
          className="h-7 rounded border-border/40 bg-card/80 px-2 text-[11px]"
        />
      )}
      {choice === "defer" && (
        <div className="flex flex-wrap gap-1.5">
          <Input
            type="date"
            value={deferUntil}
            onChange={(e) => {
              e.stopPropagation();
              onDeferUntilChange(e.target.value);
            }}
            onClick={(e) => e.stopPropagation()}
            className="h-7 w-[140px] rounded border-border/40 bg-card/80 px-2 text-[11px]"
          />
          <Input
            value={deferTrigger}
            onChange={(e) => {
              e.stopPropagation();
              onDeferTriggerChange(e.target.value);
            }}
            onClick={(e) => e.stopPropagation()}
            placeholder="Trigger (optional)"
            className="h-7 flex-1 rounded border-border/40 bg-card/80 px-2 text-[11px]"
          />
        </div>
      )}
    </div>
  );
}

function bulletsForChoice(
  choice: Choice,
  brief: DecisionBriefStored | null
): string[] {
  if (!brief) return [];
  if (choice === "yes") {
    const out = [...(brief.yes?.whyBullets ?? [])];
    if (brief.yes?.preParadeLine) out.push(`Pre-parade: ${brief.yes.preParadeLine}`);
    return out;
  }
  if (choice === "no") {
    const out = [...(brief.no?.whyBullets ?? [])];
    if (brief.no?.preMortemLine) out.push(`Pre-mortem: ${brief.no.preMortemLine}`);
    return out;
  }
  if (choice === "yes-but") return brief.yesBut?.conditions ?? [];
  if (choice === "defer") return brief.defer?.triggerCandidates ?? [];
  return [];
}

function readDecisionBrief(ctx: unknown): DecisionBriefStored | null {
  if (!ctx || typeof ctx !== "object") return null;
  const candidate = (ctx as { decision_brief?: DecisionBriefStored })
    .decision_brief;
  if (!candidate || typeof candidate !== "object") return null;
  return candidate;
}

function labelKind(kind: EnrichSourceKind): string {
  switch (kind) {
    case "s2d":
      return "s2d";
    case "gmail":
      return "gmail";
    case "slack":
      return "slack";
    case "linear":
      return "linear";
    case "fireflies":
      return "meeting";
  }
}

void X;
