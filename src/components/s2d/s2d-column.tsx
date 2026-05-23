"use client";

// translucency-audit-ok: file — legacy callsites, migrate to sanctioned scale (/15, /40, /55, /60, /80, /95) case-by-case during component touch-ups.

import { useRef, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Plus, X, Sparkles, Loader2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { S2DItem, S2DStatus, Pathway, Priority } from "@/types";
import { STATUS_META, PATHWAY_META, PRIORITY_META } from "@/types";
import { S2DItemCard } from "@/components/s2d/s2d-item-card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useCreateS2DItem } from "@/hooks/use-s2d";
import { useGSAP } from "@gsap/react";
import { staggerEntry } from "@/lib/animation";
import { SectionHeader } from "@/components/layout/primitives";

interface EnrichedDraft {
  title: string;
  description: string;
  pathway: Pathway;
  priority: Priority;
  status: S2DStatus;
  est_minutes: number | null;
  company_id: string | null;
  rationale: string;
  context_used: Array<{
    source: string;
    label: string;
    snippet: string;
    when?: string;
  }>;
}

interface Props {
  status: S2DStatus;
  items: S2DItem[];
  /** Threaded through to every S2DItemCard rendered in this column. */
  density?: "compact" | "expanded";
}

export function S2DColumn({ status, items, density = "compact" }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: status, data: { type: "column", status } });
  const meta = STATUS_META[status];
  const ids = items.map((i) => i.id);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [enriching, setEnriching] = useState(false);
  const [draft, setDraft] = useState<EnrichedDraft | null>(null);
  // Inline error — failed creates used to vanish silently, leaving the
  // user thinking the item landed. Surface the failure right under the
  // input so they can retry without checking the network tab.
  const [error, setError] = useState<string | null>(null);
  const createItem = useCreateS2DItem();
  const listRef = useRef<HTMLDivElement | null>(null);

  // Stagger the cards in when the column first paints. Only animates the
  // initial set — once the user is interacting, individual cards moving
  // around are dnd-kit's responsibility, not ours.
  useGSAP(
    () => {
      if (!listRef.current) return;
      const cards = listRef.current.querySelectorAll("[data-s2d-card]");
      if (cards.length === 0) return;
      staggerEntry(cards, { stagger: 0.025, y: 8, duration: 0.32 });
    },
    { scope: listRef, dependencies: [] }
  );

  async function commit() {
    const t = title.trim();
    if (!t) return;
    setError(null);
    try {
      await createItem.mutateAsync({
        title: t,
        status,
        pathway: "heads_down",
        priority: "medium",
        source_type: "manual",
      });
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create item");
    }
  }

  async function enrich() {
    const t = title.trim();
    if (t.length < 3) return;
    setEnriching(true);
    setError(null);
    try {
      const res = await fetch("/api/s2d/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ placeholder: t }),
      });
      const data = await res.json();
      if (res.ok && data.draft) {
        setDraft(data.draft as EnrichedDraft);
      } else {
        setError(
          (typeof data?.error === "string" && data.error) ||
            `Enrich failed (${res.status})`
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enrich request failed");
    } finally {
      setEnriching(false);
    }
  }

  async function commitDraft() {
    if (!draft) return;
    setError(null);
    try {
      await createItem.mutateAsync({
        title: draft.title,
        description: draft.description,
        status: draft.status,
        pathway: draft.pathway,
        priority: draft.priority,
        est_minutes: draft.est_minutes ?? undefined,
        source_type: "manual",
      });
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create item");
    }
  }

  function reset() {
    setTitle("");
    setDraft(null);
    setAdding(false);
    setEnriching(false);
    setError(null);
  }

  return (
    <div
      ref={setNodeRef}
      className={cn(
        // Column body. The SectionHeader sits flush at the top; the body
        // needs enough chrome to read as a contiguous column over the
        // ambient album-art ground. bg-card/60 + backdrop-blur is the
        // canonical "card over busy ambient" recipe; overflow-hidden
        // clips the header's square top corners into the column's
        // rounded-md so the strip and the body read as one surface.
        "flex h-full min-h-0 w-72 shrink-0 flex-col overflow-hidden rounded-md border border-border/40 bg-card/60 backdrop-blur-sm transition-colors",
        isOver && "border-primary/50 bg-primary/10"
      )}
    >
      <SectionHeader className="justify-between py-2.5">
        <div className="flex items-center gap-2">
          <span className="font-semibold">{meta.label}</span>
          <span className="font-mono text-[10px] normal-case tracking-normal text-muted-foreground">
            {items.length}
          </span>
        </div>
        <button
          onClick={() => setAdding((v) => !v)}
          aria-label={`Add ${meta.label} item`}
          className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {adding ? <X className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
        </button>
      </SectionHeader>

      <div ref={listRef} className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {adding && !draft && (
          <div className="space-y-1.5 rounded-md border border-border/60 bg-card p-2">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  if (e.metaKey || e.ctrlKey) {
                    e.preventDefault();
                    void enrich();
                  } else {
                    e.preventDefault();
                    void commit();
                  }
                } else if (e.key === "Escape") {
                  reset();
                }
              }}
              autoFocus
              placeholder="What's the task? (rough is fine)"
              className="h-8 text-[12px]"
            />
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="outline"
                onClick={enrich}
                disabled={!title.trim() || enriching || title.trim().length < 3}
                className="h-7 gap-1.5 text-[11px]"
                title="Mashi pulls related Fireflies / Gmail / Linear / Slack context and enriches"
              >
                {enriching ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Sparkles className="h-3 w-3" />
                )}
                {enriching ? "Pulling context…" : "Enrich with AI"}
              </Button>
              <div className="ml-auto flex gap-1">
                <Button size="sm" variant="ghost" onClick={reset} className="h-7 text-[11px]">
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={commit}
                  disabled={!title.trim() || enriching}
                  className="h-7 text-[11px]"
                >
                  Add
                </Button>
              </div>
            </div>
            <div className="text-[10px] text-muted-foreground">
              Enter to add as-is · ⌘/Ctrl+Enter to enrich with AI
            </div>
            {error && (
              <div className="flex items-start gap-1.5 rounded border border-destructive/40 bg-destructive/10 p-1.5 text-[11px] text-destructive">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                <span className="flex-1">{error}</span>
                <button
                  onClick={() => setError(null)}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Dismiss error"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>
        )}

        {adding && draft && (
          <>
            <EnrichedDraftCard
              draft={draft}
              onChange={setDraft}
              onCommit={commitDraft}
              onCancel={reset}
            />
            {error && (
              <div className="flex items-start gap-1.5 rounded border border-destructive/40 bg-destructive/10 p-1.5 text-[11px] text-destructive">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                <span className="flex-1">{error}</span>
                <button
                  onClick={() => setError(null)}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Dismiss error"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
          </>
        )}
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {items.length === 0 && !adding ? (
            <div className="flex h-20 items-center justify-center rounded border border-dashed border-border/40 text-[11px] text-muted-foreground/70">
              {status === "done" ? "Nothing done yet today." : "Drop items here"}
            </div>
          ) : (
            items.map((item) => (
              <S2DItemCard key={item.id} item={item} density={density} />
            ))
          )}
        </SortableContext>
      </div>
    </div>
  );
}

/**
 * Preview card shown after AI enrichment. User can tweak any field before
 * committing, or hit "Use AI version" to commit as-is.
 */
function EnrichedDraftCard({
  draft,
  onChange,
  onCommit,
  onCancel,
}: {
  draft: EnrichedDraft;
  onChange: (next: EnrichedDraft) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const ctxLine =
    draft.context_used.length === 0
      ? "no related context found"
      : `pulled from ${draft.context_used.length} source${draft.context_used.length === 1 ? "" : "s"}`;

  return (
    <div className="space-y-2 rounded-md border border-primary/40 bg-card p-2 ring-1 ring-primary/10">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-primary">
        <Sparkles className="h-3 w-3" />
        Mashi enriched · {ctxLine}
      </div>

      <Input
        value={draft.title}
        onChange={(e) => onChange({ ...draft, title: e.target.value })}
        className="h-7 text-[12px] font-medium"
      />

      <Textarea
        value={draft.description}
        onChange={(e) => onChange({ ...draft, description: e.target.value })}
        rows={3}
        // Overrides for the shadcn Textarea defaults: drop the min-h-20
        // floor (this is a compact 3-row input), drop the shadow, match
        // the existing tight type scale. Border tone matches secondary
        // tint of the surrounding draft surface.
        className="min-h-0 w-full resize-none rounded border-border/40 bg-secondary/30 px-2 py-1.5 text-[11px] leading-snug shadow-none focus-visible:ring-1"
      />

      <div className="grid grid-cols-2 gap-1.5">
        <select
          value={draft.pathway}
          onChange={(e) => onChange({ ...draft, pathway: e.target.value as Pathway })}
          className="rounded border border-border/40 bg-secondary px-1.5 py-1 text-[11px]"
        >
          {(Object.keys(PATHWAY_META) as Pathway[]).map((p) => (
            <option key={p} value={p}>
              {PATHWAY_META[p].label}
            </option>
          ))}
        </select>
        <select
          value={draft.priority}
          onChange={(e) => onChange({ ...draft, priority: e.target.value as Priority })}
          className="rounded border border-border/40 bg-secondary px-1.5 py-1 text-[11px]"
        >
          {(Object.keys(PRIORITY_META) as Priority[]).map((p) => (
            <option key={p} value={p}>
              {PRIORITY_META[p].label}
            </option>
          ))}
        </select>
        <select
          value={draft.status}
          onChange={(e) => onChange({ ...draft, status: e.target.value as S2DStatus })}
          className="rounded border border-border/40 bg-secondary px-1.5 py-1 text-[11px]"
        >
          <option value="todo">Todo</option>
          <option value="backlog">Backlog</option>
          <option value="in_queue">In Queue</option>
        </select>
        <input
          type="number"
          min={5}
          step={5}
          value={draft.est_minutes ?? ""}
          onChange={(e) =>
            onChange({
              ...draft,
              est_minutes: e.target.value === "" ? null : parseInt(e.target.value, 10),
            })
          }
          placeholder="est minutes"
          className="rounded border border-border/40 bg-secondary px-1.5 py-1 text-[11px]"
        />
      </div>

      {draft.rationale && (
        <div className="rounded border border-border/30 bg-secondary/30 p-1.5 text-[10px] text-muted-foreground">
          {draft.rationale}
        </div>
      )}

      {draft.context_used.length > 0 && (
        <details className="text-[10px] text-muted-foreground">
          <summary className="cursor-pointer hover:text-foreground">
            View context Mashi used
          </summary>
          <ul className="mt-1 space-y-1">
            {draft.context_used.map((c, i) => (
              <li key={i} className="border-l border-border/40 pl-1.5">
                <span className="font-mono text-[9px] uppercase">{c.source}</span>{" "}
                <span className="text-foreground/80">{c.label}</span>
                {c.snippet && (
                  <div className="line-clamp-2 text-muted-foreground/80">
                    {c.snippet}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="flex justify-end gap-1">
        <Button size="sm" variant="ghost" onClick={onCancel} className="h-7 text-[11px]">
          Discard
        </Button>
        <Button size="sm" onClick={onCommit} className="h-7 gap-1 text-[11px]">
          <Sparkles className="h-3 w-3" />
          Create
        </Button>
      </div>
    </div>
  );
}
