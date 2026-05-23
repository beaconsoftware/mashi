"use client";

// translucency-audit-ok: file — legacy callsites, migrate to sanctioned scale (/15, /40, /55, /60, /80, /95) case-by-case during component touch-ups.

import { useMemo, useState } from "react";
import { useS2DItems } from "@/hooks/use-s2d";
import { useSprintStore } from "@/store/sprint-store";
import { Button } from "@/components/ui/button";
import { ChromeBar } from "@/components/layout/primitives";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import {
  ArrowRight,
  Sparkles,
  GripVertical,
  X,
  Loader2,
  Zap,
  Wand2,
} from "lucide-react";
import { PathwayBadge } from "@/components/shared/pathway-badge";
import { PriorityDot } from "@/components/shared/priority-dot";
import { CompanyBadge } from "@/components/shared/company-badge";
import { cn } from "@/lib/utils";
import type { S2DItem } from "@/types";

/**
 * Stage 1: pick the set of items for this sprint.
 *
 * Left rail: full open-items list with filters.
 * Right rail: the ordered "today" plan, drag handles to reorder.
 * Footer: total estimated time, count, next button.
 *
 * AI ranking is on-demand only — user chose manual-first.
 */
export function PlannerPrioritize() {
  const { data: items, isLoading } = useS2DItems();
  const selected = useSprintStore((s) => s.selectedItemIds);
  const toggle = useSprintStore((s) => s.toggleSelected);
  const reorder = useSprintStore((s) => s.reorderSelected);
  const setPhase = useSprintStore((s) => s.setPhase);
  const exit = useSprintStore((s) => s.exitSprint);

  const [filter, setFilter] = useState("");
  const [ranking, setRanking] = useState(false);
  const [buildOpen, setBuildOpen] = useState(false);
  const [building, setBuilding] = useState(false);
  const [buildRationale, setBuildRationale] = useState<string | null>(null);
  const [buildParams, setBuildParams] = useState({
    durationMin: 90,
    theme: "",
    energy: "" as "" | "low" | "medium" | "high",
  });

  const open = useMemo(() => {
    if (!items) return [];
    return items.filter(
      (i) =>
        i.status !== "done" &&
        i.status !== "in_progress" // don't double-pick what's already running
    );
  }, [items]);

  const filtered = useMemo(() => {
    if (!filter.trim()) return open;
    const q = filter.toLowerCase();
    return open.filter(
      (i) =>
        i.title.toLowerCase().includes(q) ||
        (i.company?.name ?? "").toLowerCase().includes(q) ||
        (i.source_label ?? "").toLowerCase().includes(q)
    );
  }, [open, filter]);

  const selectedItems = useMemo(() => {
    const map = new Map((items ?? []).map((i) => [i.id, i]));
    return selected.map((id) => map.get(id)).filter(Boolean) as S2DItem[];
  }, [items, selected]);

  const totalMin = selectedItems.reduce((sum, i) => sum + (i.est_minutes ?? 30), 0);

  function moveUp(i: number) {
    if (i === 0) return;
    const next = [...selected];
    [next[i - 1], next[i]] = [next[i], next[i - 1]];
    reorder(next);
  }
  function moveDown(i: number) {
    if (i === selected.length - 1) return;
    const next = [...selected];
    [next[i + 1], next[i]] = [next[i], next[i + 1]];
    reorder(next);
  }

  async function aiRank() {
    if (selected.length < 2) return;
    setRanking(true);
    try {
      const res = await fetch("/api/sprint/rank", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ s2dItemIds: selected }),
      });
      const data = await res.json();
      if (res.ok && Array.isArray(data.orderedIds)) {
        reorder(data.orderedIds);
      }
    } finally {
      setRanking(false);
    }
  }

  async function buildSprint() {
    if (
      selected.length > 0 &&
      !confirm("Replace your current selection with Mashi's picks?")
    ) {
      return;
    }
    setBuilding(true);
    setBuildRationale(null);
    try {
      const res = await fetch("/api/sprint/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          durationMin: buildParams.durationMin,
          theme: buildParams.theme || undefined,
          energy: buildParams.energy || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok && Array.isArray(data.orderedIds)) {
        reorder(data.orderedIds);
        setBuildRationale(data.rationale ?? "");
        setBuildOpen(false);
      }
    } finally {
      setBuilding(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PlannerHeader phase="prioritize" onCancel={exit} />

      <div className="grid flex-1 min-h-0 grid-cols-1 gap-4 p-4 md:grid-cols-2">
        {/* Left: open items pool */}
        <div className="flex min-h-0 flex-col rounded-md border border-border/60 bg-card">
          <div className="border-b border-border/40 p-3">
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter open items…"
              className="text-[12px]"
            />
            <div className="mt-2 text-[10px] uppercase tracking-wider text-muted-foreground">
              {filtered.length} of {open.length} open
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground">
                Loading…
              </div>
            ) : (
              <ul className="divide-y divide-border/30">
                {filtered.map((it) => {
                  const picked = selected.includes(it.id);
                  return (
                    <li
                      key={it.id}
                      onClick={() => toggle(it.id)}
                      className={cn(
                        "flex cursor-pointer items-start gap-2 px-3 py-2 text-[12px] hover:bg-accent/30",
                        picked && "bg-primary/5"
                      )}
                    >
                      <Checkbox
                        checked={picked}
                        // Row click is the canonical toggle interaction; the
                        // checkbox is a read-only visual cue. Suppress the
                        // built-in toggle so the click doesn't double-fire.
                        onCheckedChange={() => undefined}
                        className="mt-1 pointer-events-none"
                        tabIndex={-1}
                        aria-hidden
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-[10px] text-muted-foreground">
                            MASH-{it.ticket_number}
                          </span>
                          <PriorityDot priority={it.priority} />
                          <PathwayBadge pathway={it.pathway} />
                          {it.est_minutes != null && (
                            <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                              {it.est_minutes}m
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 line-clamp-2 text-foreground/90">{it.title}</div>
                        <div className="mt-1">
                          <CompanyBadge company={it.company} />
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* Right: ordered plan */}
        <div className="flex min-h-0 flex-col rounded-md border border-border/60 bg-card">
          <div className="border-b border-border/40 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider">
                Your plan
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setBuildOpen((x) => !x)}
                  disabled={building}
                  className="gap-1.5 h-7 text-[11px]"
                  title="Mashi auto-builds a sprint from your open pool"
                >
                  <Wand2 className="h-3 w-3" />
                  Build for me
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={aiRank}
                  disabled={ranking || selected.length < 2}
                  className="gap-1.5 h-7 text-[11px]"
                >
                  {ranking ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Sparkles className="h-3 w-3" />
                  )}
                  {ranking ? "Ranking…" : "AI rank"}
                </Button>
              </div>
            </div>
            <TimeBudgetBar minutes={totalMin} itemCount={selectedItems.length} />
            {buildRationale && (
              <div className="rounded border border-primary/30 bg-primary/5 p-2 text-[11px] text-foreground/80">
                <span className="font-semibold text-primary">Mashi:</span>{" "}
                {buildRationale}
              </div>
            )}
            {buildOpen && (
              <BuildPanel
                params={buildParams}
                onChange={setBuildParams}
                onBuild={buildSprint}
                onCancel={() => setBuildOpen(false)}
                busy={building}
              />
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {selectedItems.length === 0 ? (
              <div className="flex h-full items-center justify-center px-4 text-center text-[12px] text-muted-foreground">
                Pick items from the left to build today's plan.
              </div>
            ) : (
              <ol className="space-y-1.5">
                {selectedItems.map((it, i) => (
                  <li
                    key={it.id}
                    className="flex items-start gap-2 rounded border border-border/40 bg-secondary/30 p-2 text-[12px]"
                  >
                    <div className="flex flex-col gap-0.5 pt-0.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => moveUp(i)}
                        disabled={i === 0}
                        aria-label="Move up"
                        className="mashi-icon-glow h-4 w-4 text-muted-foreground hover:text-foreground disabled:opacity-30"
                      >
                        <GripVertical className="h-3 w-3 rotate-90" />
                      </Button>
                    </div>
                    <span className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-[10px] text-muted-foreground">
                          MASH-{it.ticket_number}
                        </span>
                        <PriorityDot priority={it.priority} />
                        {it.est_minutes != null && (
                          <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                            {it.est_minutes}m
                          </span>
                        )}
                      </div>
                      <div className="line-clamp-2 text-foreground/90">{it.title}</div>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => moveUp(i)}
                        disabled={i === 0}
                        aria-label="Move up"
                        className="mashi-icon-glow h-4 w-4 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-30"
                      >
                        ↑
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => moveDown(i)}
                        disabled={i === selected.length - 1}
                        aria-label="Move down"
                        className="mashi-icon-glow h-4 w-4 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-30"
                      >
                        ↓
                      </Button>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => toggle(it.id)}
                      title="Remove"
                      aria-label="Remove"
                      className="mashi-icon-glow h-5 w-5 text-muted-foreground hover:text-destructive"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-border/40 px-4 py-3">
        <Button variant="ghost" size="sm" onClick={exit}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={selected.length === 0}
          onClick={() => setPhase("schedule")}
          className="gap-1.5"
        >
          Setup
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

/**
 * Visual time budget. Color thresholds:
 *   0–60m   green
 *   60–90m  amber
 *   90–120m orange
 *   120m+   red (you're overcommitted)
 *
 * The bar maxes visually at 120m so you can still see the overflow as a
 * red bar past full width.
 */
function TimeBudgetBar({ minutes, itemCount }: { minutes: number; itemCount: number }) {
  const ZONES = [
    { upTo: 60, color: "bg-emerald-500", label: "tight" },
    { upTo: 90, color: "bg-yellow-500", label: "solid" },
    { upTo: 120, color: "bg-orange-500", label: "heavy" },
    { upTo: Infinity, color: "bg-red-500", label: "overcommitted" },
  ];
  const zone = ZONES.find((z) => minutes <= z.upTo) ?? ZONES[ZONES.length - 1];
  const VISUAL_MAX = 120;
  const pct = Math.min(100, (minutes / VISUAL_MAX) * 100);
  const overflowPct =
    minutes > VISUAL_MAX ? Math.min(40, ((minutes - VISUAL_MAX) / VISUAL_MAX) * 100) : 0;

  return (
    <div>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>
          {itemCount} {itemCount === 1 ? "item" : "items"} · {minutes}m
        </span>
        <span className="font-medium" style={{ color: minutes === 0 ? undefined : undefined }}>
          {minutes === 0 ? "empty" : zone.label}
        </span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
        <div className="flex h-full">
          <div
            className={cn("h-full transition-all duration-500", zone.color)}
            style={{ width: `${pct}%` }}
          />
          {overflowPct > 0 && (
            <div
              className="h-full bg-red-500/60 transition-all duration-500"
              style={{ width: `${overflowPct}%` }}
            />
          )}
        </div>
      </div>
      <div className="mt-1 flex justify-between text-[9px] text-muted-foreground/60 font-mono">
        <span>0</span>
        <span>30</span>
        <span>60</span>
        <span>90</span>
        <span>2h</span>
      </div>
    </div>
  );
}

/**
 * Inline constraint panel for the "Build me a sprint" flow. Duration +
 * theme + energy. Submit fires /api/sprint/build, which returns a ranked
 * subset that fits the budget and matches the theme.
 */
function BuildPanel({
  params,
  onChange,
  onBuild,
  onCancel,
  busy,
}: {
  params: { durationMin: number; theme: string; energy: "" | "low" | "medium" | "high" };
  onChange: (
    p: { durationMin: number; theme: string; energy: "" | "low" | "medium" | "high" }
  ) => void;
  onBuild: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const THEME_CHIPS = [
    "Decisions",
    "Quick wins",
    "Snailworks",
    "MAP",
    "MPP",
    "Heads-down",
    "Replies",
  ];

  return (
    <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-2.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-primary">
        <Wand2 className="h-3 w-3" />
        Build me a sprint
      </div>

      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground w-14">
          Duration
        </span>
        <Slider
          min={30}
          max={180}
          step={15}
          value={[params.durationMin]}
          onValueChange={(v) => onChange({ ...params, durationMin: v[0] ?? 30 })}
          className="flex-1"
          aria-label="Sprint duration"
        />
        <span className="font-mono text-[11px] tabular-nums w-12 text-right">
          {params.durationMin}m
        </span>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Theme</div>
        <Input
          value={params.theme}
          onChange={(e) => onChange({ ...params, theme: e.target.value })}
          placeholder="e.g. Snailworks · quick wins · decisions"
          className="mt-1 h-7 text-[11px]"
        />
        <div className="mt-1 flex flex-wrap gap-1">
          {THEME_CHIPS.map((c) => (
            <Button
              key={c}
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                onChange({
                  ...params,
                  theme:
                    params.theme.toLowerCase() === c.toLowerCase()
                      ? ""
                      : c,
                })
              }
              className={cn(
                "h-auto rounded border px-1.5 py-0.5 text-[10px] font-normal transition-colors",
                params.theme.toLowerCase() === c.toLowerCase()
                  ? "border-primary bg-primary/20 text-foreground hover:bg-primary/25 hover:text-foreground"
                  : "border-border/40 bg-secondary text-muted-foreground hover:bg-accent"
              )}
            >
              {c}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground w-14">
          Energy
        </span>
        <div className="flex gap-1">
          {(["", "low", "medium", "high"] as const).map((e) => (
            <Button
              key={e || "auto"}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onChange({ ...params, energy: e })}
              className={cn(
                "h-auto rounded border px-1.5 py-0.5 text-[10px] font-normal transition-colors",
                params.energy === e
                  ? "border-primary bg-primary/20 text-foreground hover:bg-primary/25 hover:text-foreground"
                  : "border-border/40 bg-secondary text-muted-foreground hover:bg-accent"
              )}
            >
              {e || "auto"}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex justify-end gap-1.5">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy} className="h-7 text-[11px]">
          Cancel
        </Button>
        <Button size="sm" onClick={onBuild} disabled={busy} className="h-7 gap-1.5 text-[11px]">
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
          {busy ? "Building…" : "Build"}
        </Button>
      </div>
    </div>
  );
}

export function PlannerHeader({
  phase,
  onCancel: _onCancel,
}: {
  phase: "prioritize" | "schedule" | "review";
  onCancel: () => void;
}) {
  void _onCancel;
  const steps: Array<{ key: typeof phase; label: string }> = [
    { key: "prioritize", label: "Prioritize" },
    { key: "schedule", label: "Setup" },
    { key: "review", label: "Review" },
  ];
  const activeIdx = steps.findIndex((s) => s.key === phase);
  return (
    <ChromeBar className="flex items-center justify-between px-4 py-3">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">Sprint planner</span>
      </div>
      <ol className="flex items-center gap-1">
        {steps.map((s, i) => (
          <li key={s.key} className="flex items-center gap-1">
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider",
                i === activeIdx
                  ? "bg-primary text-primary-foreground"
                  : i < activeIdx
                  ? "bg-primary/15 text-foreground/80"
                  : "bg-secondary text-muted-foreground"
              )}
            >
              {i + 1}. {s.label}
            </span>
            {i < steps.length - 1 && <span className="text-muted-foreground/60">›</span>}
          </li>
        ))}
      </ol>
    </ChromeBar>
  );
}
