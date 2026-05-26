"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useS2DItems } from "@/hooks/use-s2d";
import {
  useSprintStore,
  MAX_PARALLEL_SLOTS,
  type SprintBlock,
} from "@/store/sprint-store";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Surface, SectionHeader } from "@/components/layout/primitives";
import { PATHWAY_META, type S2DItem, type Pathway } from "@/types";
import { ArrowLeft, Play, Loader2, Sparkles } from "lucide-react";
import { useGSAP } from "@gsap/react";
import { heroEntry, staggerEntry, withMotion } from "@/lib/animation";
import { schedulePrewarm } from "@/lib/sprint/prewarm-scheduler";
import { cn } from "@/lib/utils";

/**
 * Contract Card (Phase 5 — Phase A "Commit" of the reimagined arc).
 *
 * Sits between planner-review's lock-in and the takeover. The user:
 *   1. Reads / edits a one-line success statement per item ("At the end
 *      of this sprint you will have…"). Mashi pre-fills via the
 *      success-statement LLM helper.
 *   2. Opts in (or out) of the decision-gate pre-warm — the higher-cost
 *      brief that fills the 4 choice cards on the DecideCanvas.
 *   3. Pre-warming begins on mount for every block whose pathway is NOT
 *      decision_gate (free pathways), so the canvases are cooking while
 *      the user reads.
 *
 * Phase 5 acceptance criteria covered here:
 *   - Planner routes "Start sprint" into this card (review.tsx wires it).
 *   - Contract card pre-fills success statements; edits persist via
 *     POST /api/sprint/contract action="commit".
 *   - Decision pre-warm opt-in checkbox writes block.prewarm_opt_in via
 *     the sprint store.
 *   - Hitting Start launches the takeover with pre-warm already in
 *     flight (cheap pathways began warming on mount; opted-in decisions
 *     fire on Start).
 */
export function ContractCard() {
  const blocks = useSprintStore((s) => s.blocks);
  const updateBlock = useSprintStore((s) => s.updateBlock);
  const setPhase = useSprintStore((s) => s.setPhase);
  const start = useSprintStore((s) => s.startSprint);
  const exit = useSprintStore((s) => s.exitSprint);
  const { data: items } = useS2DItems();

  const itemMap = useMemo(
    () => new Map((items ?? []).map((i) => [i.id, i])),
    [items]
  );

  // success_statement state, keyed by s2dItemId. Pre-fills from
  // /api/sprint/contract action="generate" on mount.
  const [statements, setStatements] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    for (const b of blocks) {
      const it = itemMap.get(b.s2dItemId);
      if (it?.success_statement) seed[b.s2dItemId] = it.success_statement;
    }
    return seed;
  });
  const [generating, setGenerating] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [launchErr, setLaunchErr] = useState<string | null>(null);

  // Sprint shape: pathway icons in slot order, then queue.
  const totalMin = blocks.reduce((s, b) => s + b.durationMin, 0);
  const startingSlots = blocks.slice(0, MAX_PARALLEL_SLOTS);
  const queuedBlocks = blocks.slice(MAX_PARALLEL_SLOTS);

  // ── Pre-warm on mount ──────────────────────────────────────────────
  // Cheap pathways start warming immediately so the canvas is cooked by
  // the time the user clicks Start. decision_gate stays gated on the
  // user's opt-in toggle; if they tick it, we don't fire here — wait
  // for Start so we don't burn tokens if they back out.
  useEffect(() => {
    if (!items) return;
    for (let i = 0; i < blocks.length && i < MAX_PARALLEL_SLOTS; i += 1) {
      const b = blocks[i];
      const it = itemMap.get(b.s2dItemId);
      if (!it) continue;
      if (it.pathway === "decision_gate") continue;
      if (b.prewarm_status && b.prewarm_status !== "pending") continue;
      schedulePrewarm({ block: b, item: it, reason: "activate" });
    }
    // Run once when items load; the scheduler dedupes if effect re-runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  // ── AI-fill success statements ─────────────────────────────────────
  // Mount-time generate. Skip if every item already has one persisted
  // (e.g. user came back via Edit shape).
  useEffect(() => {
    if (!items) return;
    if (blocks.length === 0) return;
    const needsFill = blocks.some(
      (b) =>
        !(itemMap.get(b.s2dItemId)?.success_statement) &&
        !statements[b.s2dItemId]
    );
    if (!needsFill) return;
    let cancelled = false;
    setGenerating(true);
    (async () => {
      try {
        const payload = blocks
          .map((b) => itemMap.get(b.s2dItemId))
          .filter((it): it is S2DItem => !!it)
          .map((it) => ({
            id: it.id,
            title: it.title,
            pathway: it.pathway,
            description: it.description ?? null,
          }));
        const res = await fetch("/api/sprint/contract", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "generate", items: payload }),
        });
        const j = (await res.json().catch(() => ({}))) as {
          statements?: Array<{ itemId: string; statement: string }>;
        };
        if (cancelled) return;
        if (Array.isArray(j.statements)) {
          setStatements((prev) => {
            const next = { ...prev };
            for (const s of j.statements!) {
              if (!next[s.itemId]) next[s.itemId] = s.statement;
            }
            return next;
          });
        }
      } catch {
        // Fallback: leave empty; user can still type their own.
      } finally {
        if (!cancelled) setGenerating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  // ── Hero entry ─────────────────────────────────────────────────────
  const rootRef = useRef<HTMLDivElement | null>(null);
  const sparkleRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  useGSAP(
    () => {
      withMotion(() => {
        if (rootRef.current) heroEntry(rootRef.current);
        if (listRef.current) {
          staggerEntry(listRef.current.children, {
            delay: 0.15,
            stagger: 0.05,
          });
        }
      });
    },
    { scope: rootRef }
  );

  function setStatement(id: string, val: string) {
    setStatements((prev) => ({ ...prev, [id]: val }));
  }

  function toggleOptIn(id: string, value: boolean) {
    updateBlock(id, { prewarm_opt_in: value });
  }

  async function launch() {
    setLaunching(true);
    setLaunchErr(null);
    try {
      // Persist success statements. Best-effort — a failed commit
      // doesn't block the sprint launch, but we surface the error.
      try {
        await fetch("/api/sprint/contract", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "commit",
            successStatements: statements,
          }),
        });
      } catch (e) {
        setLaunchErr(e instanceof Error ? e.message : "commit failed");
      }

      // Fire opted-in decision-gate pre-warms now (we held off on mount
      // so the user could back out without burning tokens).
      for (const b of blocks.slice(0, MAX_PARALLEL_SLOTS)) {
        const it = itemMap.get(b.s2dItemId);
        if (!it) continue;
        if (it.pathway !== "decision_gate") continue;
        if (!b.prewarm_opt_in) continue;
        schedulePrewarm({ block: b, item: it, reason: "activate" });
      }

      start();
    } finally {
      setLaunching(false);
    }
  }

  if (blocks.length === 0) {
    return (
      <div className="flex h-full flex-1 items-center justify-center p-6">
        <Surface className="px-6 py-6 text-center text-sm text-muted-foreground">
          No blocks to commit. Head back to the planner.
        </Surface>
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className="flex h-full flex-1 items-center justify-center p-4 md:p-6"
    >
      <Surface className="w-full max-w-2xl overflow-hidden" shadow="md">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border/40 px-5 py-3">
          <div
            ref={sparkleRef}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/15"
          >
            <Sparkles className="h-3.5 w-3.5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">Commit to the sprint</div>
            <div className="text-[11px] text-muted-foreground">
              {blocks.length} item{blocks.length === 1 ? "" : "s"} · {totalMin}m
              total · Mashi is pre-warming the work below.
            </div>
          </div>
        </div>

        {/* Sprint shape — pathway glyphs in order */}
        <SectionHeader>Sprint shape</SectionHeader>
        <div className="border-b border-border/40 px-5 py-3">
          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            {startingSlots.map((b, idx) => {
              const it = itemMap.get(b.s2dItemId);
              if (!it) return null;
              return (
                <ShapeChip
                  key={b.s2dItemId}
                  duration={b.durationMin}
                  pathway={it.pathway}
                  slotIdx={idx + 1}
                  inSlot
                />
              );
            })}
            {queuedBlocks.length > 0 && (
              <>
                <span className="text-muted-foreground">·</span>
                {queuedBlocks.map((b) => {
                  const it = itemMap.get(b.s2dItemId);
                  if (!it) return null;
                  return (
                    <ShapeChip
                      key={b.s2dItemId}
                      duration={b.durationMin}
                      pathway={it.pathway}
                      inSlot={false}
                    />
                  );
                })}
              </>
            )}
          </div>
        </div>

        {/* At the end of this sprint you will have… */}
        <SectionHeader>At the end of this sprint you will have</SectionHeader>
        <div className="border-b border-border/40 px-5 py-3">
          <div ref={listRef} className="space-y-2">
            {blocks.map((b) => {
              const it = itemMap.get(b.s2dItemId);
              if (!it) return null;
              const meta = PATHWAY_META[it.pathway];
              return (
                <div
                  key={b.s2dItemId}
                  className="flex items-start gap-2 rounded-md border border-border/40 bg-card/80 p-2.5"
                >
                  <span
                    className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded text-[14px]"
                    style={{
                      color: `hsl(var(${meta.colorVar}))`,
                      backgroundColor: `hsl(var(${meta.colorVar}) / 0.15)`,
                    }}
                    title={meta.label}
                  >
                    {meta.icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-1 text-[11px] text-muted-foreground">
                      MASH-{it.ticket_number} · {it.title}
                    </div>
                    <Textarea
                      value={statements[b.s2dItemId] ?? ""}
                      onChange={(e) =>
                        setStatement(b.s2dItemId, e.target.value)
                      }
                      placeholder={
                        generating ? "Drafting…" : "What does done look like?"
                      }
                      rows={1}
                      className="mt-1 min-h-0 resize-none px-2 py-1 text-[13px] leading-snug"
                      maxLength={200}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Pre-warm summary */}
        <SectionHeader>Mashi will pre-warm the work</SectionHeader>
        <div className="border-b border-border/40 px-5 py-3">
          <ul className="space-y-1.5 text-[12px]">
            {startingSlots.map((b) => {
              const it = itemMap.get(b.s2dItemId);
              if (!it) return null;
              return (
                <PrewarmRow
                  key={b.s2dItemId}
                  item={it}
                  block={b}
                  onToggleOptIn={(v) => toggleOptIn(b.s2dItemId, v)}
                />
              );
            })}
          </ul>
        </div>

        {launchErr && (
          <div className="border-b border-destructive/40 bg-destructive/10 px-5 py-2 text-[12px] text-destructive">
            {launchErr}
          </div>
        )}

        {/* Footer actions */}
        <div className="flex items-center justify-between gap-2 px-5 py-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPhase("schedule")}
            disabled={launching}
            className="gap-1.5"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Edit shape
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={exit}
              disabled={launching}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={launch}
              disabled={launching}
              className="gap-1.5"
            >
              {launching ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              {launching ? "Starting…" : "Start sprint →"}
            </Button>
          </div>
        </div>
      </Surface>
    </div>
  );
}

function ShapeChip({
  duration,
  pathway,
  slotIdx,
  inSlot,
}: {
  duration: number;
  pathway: Pathway;
  slotIdx?: number;
  inSlot: boolean;
}) {
  const meta = PATHWAY_META[pathway];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[11px]",
        inSlot
          ? "border-border/60 bg-card"
          : "border-border/30 bg-card/60 text-muted-foreground"
      )}
      title={`${meta.label} · ${duration}m${slotIdx ? ` · slot ${slotIdx}` : ""}`}
    >
      <span
        className="text-[13px]"
        style={{ color: `hsl(var(${meta.colorVar}))` }}
      >
        {meta.icon}
      </span>
      <span>{meta.shortLabel}</span>
      <span className="text-muted-foreground">[{duration}m]</span>
    </span>
  );
}

function PrewarmRow({
  item,
  block,
  onToggleOptIn,
}: {
  item: S2DItem;
  block: SprintBlock;
  onToggleOptIn: (v: boolean) => void;
}) {
  const meta = PATHWAY_META[item.pathway];
  const isDecision = item.pathway === "decision_gate";
  const description = prewarmDescription(item.pathway);
  return (
    <li className="flex items-start gap-2">
      <span
        className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-[12px]"
        style={{ color: `hsl(var(${meta.colorVar}))` }}
      >
        {meta.icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-foreground/90">{description}</span>
          {isDecision ? (
            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-300">
              ~$0.05 extra
            </span>
          ) : (
            <span className="text-[11px] text-muted-foreground">(free)</span>
          )}
        </div>
        {isDecision && (
          <label className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Checkbox
              checked={block.prewarm_opt_in === true}
              onCheckedChange={(v) => onToggleOptIn(v === true)}
              className="h-3.5 w-3.5"
            />
            <span>Build the decision brief before I arrive</span>
          </label>
        )}
      </div>
    </li>
  );
}

function prewarmDescription(pathway: Pathway): string {
  switch (pathway) {
    case "quick_reply":
      return "Draft ready when you arrive";
    case "drafted_response":
      return "Draft ready, voice-matched";
    case "decision_gate":
      return "Decision brief with pre-mortem";
    case "heads_down":
      return "3-step plan + handoff prompt";
    case "meeting_backed":
      return "Candidate meetings + talking points";
    case "delegated":
      return "Activity scan + nudge draft if stale";
    case "watching":
      return "Signals since last check-in";
  }
}
