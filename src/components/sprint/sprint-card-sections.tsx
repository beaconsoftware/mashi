"use client";

// translucency-audit-ok: file — sprint card chrome composed of sanctioned /15 + /55 surfaces, see AGENTS.md.

import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Wand2,
  Bot,
  Mail,
  CheckSquare,
  Loader2,
  RefreshCw,
  Inbox,
  Calendar,
  GitBranch,
  KanbanSquare,
  MessageSquare,
  Pin,
  PinOff,
  Send,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { S2DItem } from "@/types";
import { SprintContextPackage } from "./sprint-context-package";
import { SprintItemContext } from "./sprint-item-context";
import {
  useEnrichedContext,
  useRunEnrich,
  usePinSource,
  type EnrichPulledSource,
  type EnrichSourceKind,
  type EnrichedContext,
  type EnrichThreadTurn,
} from "@/hooks/use-enriched-context";

/**
 * Sprint Card v2 — the four-section flow that sits between the timer
 * and the Move row inside an active sprint slot.
 *
 *   1 · CONTEXT          what we know about this item (always open)
 *   2 · ENRICH + PLAN    agentic context + 3-step plan (PR 3)
 *                        + refine thread (PR 4)
 *   3 · ACT              tabbed actions — Claude / Draft / Decide
 *                        (PRs 5-7)
 *   4 · MOVE             Done / Skip / Bench / Snooze / Detail
 *                        (rendered by the parent SlotCard)
 *
 * PR 2 ships the layout shell only — Sections 2 and 3 render
 * collapsed placeholders that wire up to the live agents in later PRs.
 * Section 1 wraps the existing SprintContextPackage + SprintItemContext
 * so the Claude affordances and source list keep working today.
 */

interface Props {
  item: S2DItem;
  /**
   * When the slot is benched / queued, suppress any expensive
   * fetches inside subcomponents.
   */
  active?: boolean;
}

export function SprintCardSections({ item, active = true }: Props) {
  return (
    <div className="space-y-3">
      <Section1Context item={item} active={active} />
      <Section2EnrichPlan item={item} />
      <Section3Act item={item} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Section 1 · CONTEXT — what we already know
// ─────────────────────────────────────────────────────────────────────

function Section1Context({ item, active }: { item: S2DItem; active: boolean }) {
  return (
    <SectionShell number={1} title="Context" tagline="what we know">
      <div className="space-y-3">
        <SprintContextPackage item={item} />
        <SprintItemContext item={item} enabled={active} />
      </div>
    </SectionShell>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Section 2 · ENRICH + PLAN — placeholder
//   PR 3 wires this to POST /api/s2d/{id}/enrich and renders plan +
//   pulled_sources. PR 4 adds the refine thread.
// ─────────────────────────────────────────────────────────────────────

function Section2EnrichPlan({ item }: { item: S2DItem }) {
  const { data, isLoading: reading } = useEnrichedContext(item.id);
  const run = useRunEnrich(item.id);
  const ctx = data?.enriched_context ?? null;
  const hasRun = !!ctx && ctx.plan.length + ctx.pulled_sources.length > 0;
  // Auto-open the section once we have an enriched payload to show, so
  // the user lands on the result without having to expand. Closed by
  // default when no enrichment exists yet — keeps the card compact.
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (hasRun) setOpen(true);
  }, [hasRun]);
  const busy = run.isPending;
  const error = run.error;

  function handleRun() {
    if (busy) return;
    setOpen(true);
    run.mutate(undefined);
  }

  return (
    <SectionShell
      number={2}
      title="Enrich + Plan"
      tagline={hasRun ? labelFromTimestamp(ctx?.last_enriched_at) : "generate context"}
      collapsible
      open={open}
      onToggle={() => setOpen((v) => !v)}
      headerRight={
        <Button
          type="button"
          size="sm"
          onClick={handleRun}
          disabled={busy || reading}
          className="h-6 gap-1 px-2 text-[11px]"
          title={hasRun ? "Re-run enrich (replaces plan + non-pinned sources)" : "Run the pathway-routed enrich agent"}
        >
          {busy ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : hasRun ? (
            <RefreshCw className="h-3 w-3" />
          ) : (
            <Wand2 className="h-3 w-3" />
          )}
          {busy ? "Running" : hasRun ? "Re-run" : "Run Enrich"}
        </Button>
      }
    >
      {!hasRun && !busy && !error && (
        <div className="rounded-md border border-dashed border-border/40 bg-secondary/20 p-3 text-[11px] text-muted-foreground">
          Run Enrich to pull related context (Mashi items, recent
          messages, meetings, Linear) and get a 3-step plan grounded
          in those sources.
        </div>
      )}
      {busy && (
        <div className="flex items-center gap-2 rounded-md border border-border/40 bg-secondary/20 p-3 text-[11px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Searching your data and writing a plan…
        </div>
      )}
      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-[11px] text-destructive">
          Enrich failed: {error instanceof Error ? error.message : String(error)}
        </div>
      )}
      {hasRun && ctx && <EnrichResult ctx={ctx} itemId={item.id} />}
    </SectionShell>
  );
}

function EnrichResult({ ctx, itemId }: { ctx: EnrichedContext; itemId: string }) {
  return (
    <div className="space-y-3">
      {ctx.plan.length > 0 && (
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Plan
          </div>
          <ol className="space-y-1 text-[12px] leading-snug text-foreground/90">
            {ctx.plan.map((step, i) => (
              <li key={i} className="flex gap-2">
                <span className="font-mono text-[10px] text-muted-foreground">{i + 1}.</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
      <PulledSourcesList sources={ctx.pulled_sources} itemId={itemId} />
      <RefineThread thread={ctx.thread} itemId={itemId} />
    </div>
  );
}

/**
 * Show the refine conversation + a composer. Default: collapsed to the
 * last assistant turn so the card stays compact. "Show full history"
 * expands.
 *
 * The first thread pair is the canonical "Enrich this item: <title>" →
 * <assistant reply>. Refine turns get appended. Each assistant turn
 * inherits a thin border so it reads as a reply, not a separate block.
 */
function RefineThread({
  thread,
  itemId,
}: {
  thread: EnrichThreadTurn[];
  itemId: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const [draft, setDraft] = useState("");
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const run = useRunEnrich(itemId);
  const busy = run.isPending;

  // Decide what to render. The first user/assistant pair is the
  // initial enrich result; we surface the LATEST assistant message
  // (already shown above as "Plan + assistant note") + any subsequent
  // refine turns. If there are no refine turns, just the composer.
  const initialPairLen = 2; // user[0] + assistant[1]
  const refineTurns = thread.slice(initialPairLen);
  const visible = showAll ? refineTurns : refineTurns.slice(-2 * 1); // show last 1 q/a pair when collapsed
  const hiddenCount = refineTurns.length - visible.length;

  async function handleSend() {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    try {
      await run.mutateAsync(text);
    } catch {
      // Restore the draft so the user can edit + retry; the mutation
      // hook surfaces the error on the run object too.
      setDraft(text);
    }
    composerRef.current?.focus();
  }

  return (
    <div className="space-y-2">
      {refineTurns.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Refine
            {hiddenCount > 0 && !showAll && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowAll(true)}
                className="h-auto px-1 py-0 text-[10px] font-normal tracking-normal text-muted-foreground hover:bg-transparent hover:text-foreground"
              >
                · show {hiddenCount} earlier {hiddenCount === 1 ? "turn" : "turns"}
              </Button>
            )}
          </div>
          <ul className="space-y-1.5">
            {visible.map((turn, i) => (
              <li
                key={`${turn.at}:${i}`}
                className={cn(
                  "rounded-md border px-2 py-1.5 text-[11px] leading-snug",
                  turn.role === "user"
                    ? "border-border/30 bg-secondary/30 text-foreground/90"
                    : "border-primary/30 bg-primary/5 text-muted-foreground"
                )}
              >
                <div className="mb-0.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">
                  {turn.role === "user" ? "you" : "mashi"}
                </div>
                {turn.content}
              </li>
            ))}
          </ul>
        </div>
      )}
      {/* Composer */}
      <div className="flex items-start gap-1.5">
        <Textarea
          ref={composerRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.key === "Enter" && (e.metaKey || e.ctrlKey)) || (e.key === "Enter" && !e.shiftKey)) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="Refine — find me examples from May, focus on Linear only, …"
          rows={2}
          className="min-h-0 resize-none rounded-md border-border/40 bg-card/55 px-2 py-1.5 text-[11px] leading-snug placeholder:text-muted-foreground/70"
          disabled={busy}
        />
        <Button
          type="button"
          size="sm"
          onClick={handleSend}
          disabled={busy || draft.trim().length === 0}
          className="h-8 gap-1 px-2 text-[11px]"
          title="Send refine (Enter; Shift+Enter for newline)"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
        </Button>
      </div>
    </div>
  );
}

function PulledSourcesList({
  sources,
  itemId,
}: {
  sources: EnrichPulledSource[];
  itemId: string;
}) {
  const [open, setOpen] = useState(false);
  const pin = usePinSource(itemId);
  if (sources.length === 0) {
    return (
      <div className="text-[11px] text-muted-foreground">
        No related sources surfaced for this query.
      </div>
    );
  }
  // Group by kind for a quick visual scan.
  const groups: Record<EnrichSourceKind, EnrichPulledSource[]> = {
    s2d: [],
    gmail: [],
    slack: [],
    linear: [],
    fireflies: [],
  };
  for (const s of sources) groups[s.kind].push(s);
  const groupCounts = (Object.entries(groups) as Array<[EnrichSourceKind, EnrichPulledSource[]]>)
    .filter(([, list]) => list.length > 0)
    .map(([kind, list]) => `${list.length} ${labelForKind(kind, list.length)}`);
  return (
    <div>
      <Button
        type="button"
        variant="ghost"
        onClick={() => setOpen((v) => !v)}
        className="flex h-auto w-full items-center justify-start gap-1 px-0 py-0 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:bg-transparent hover:text-foreground"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        Pulled context ({sources.length})
        <span className="ml-2 font-normal normal-case tracking-normal text-muted-foreground/70">
          {groupCounts.join(" · ")}
        </span>
      </Button>
      {open && (
        <ul className="mt-1.5 space-y-1.5">
          {sources.map((s, i) => (
            <li
              key={`${s.kind}:${s.ref}:${i}`}
              className={cn(
                "flex items-start gap-2 rounded border px-2 py-1.5",
                s.pinned ? "border-primary/40 bg-primary/5" : "border-border/30 bg-card/55"
              )}
            >
              <SourceKindIcon kind={s.kind} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[11px] font-medium text-foreground/90">
                  {s.label}
                </div>
                {s.snippet && (
                  <div className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-muted-foreground">
                    {s.snippet}
                  </div>
                )}
              </div>
              {s.when && (
                <span className="shrink-0 font-mono text-[9px] text-muted-foreground/70">
                  {s.when.slice(0, 10)}
                </span>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  pin.mutate({ source: { kind: s.kind, ref: s.ref }, pinned: !s.pinned })
                }
                className={cn(
                  "h-6 w-6 shrink-0 p-0",
                  s.pinned
                    ? "text-primary hover:bg-primary/15 hover:text-primary"
                    : "text-muted-foreground/70 hover:bg-accent hover:text-foreground"
                )}
                title={
                  s.pinned
                    ? "Unpin — drops from future refine turns"
                    : "Pin — keeps this source across refine turns + downstream actions"
                }
                aria-pressed={s.pinned}
                aria-label={s.pinned ? "Unpin source" : "Pin source"}
              >
                {s.pinned ? <Pin className="h-3 w-3" /> : <PinOff className="h-3 w-3" />}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SourceKindIcon({ kind }: { kind: EnrichSourceKind }) {
  const props = { className: "h-3 w-3 shrink-0 text-muted-foreground" };
  switch (kind) {
    case "s2d":
      return <KanbanSquare {...props} />;
    case "gmail":
      return <Inbox {...props} />;
    case "slack":
      return <MessageSquare {...props} />;
    case "linear":
      return <GitBranch {...props} />;
    case "fireflies":
      return <Calendar {...props} />;
  }
}

function labelForKind(kind: EnrichSourceKind, n: number): string {
  const single =
    kind === "s2d"
      ? "Mashi item"
      : kind === "gmail"
        ? "email"
        : kind === "slack"
          ? "Slack"
          : kind === "linear"
            ? "Linear"
            : "meeting";
  return n === 1 ? single : `${single}${single.endsWith("s") ? "" : "s"}`;
}

function labelFromTimestamp(iso: string | null | undefined): string {
  if (!iso) return "generate context";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "enriched just now";
  if (ms < 60 * 60_000) return `enriched ${Math.round(ms / 60_000)}m ago`;
  if (ms < 24 * 60 * 60_000) return `enriched ${Math.round(ms / 3_600_000)}h ago`;
  return `enriched ${new Date(iso).toISOString().slice(0, 10)}`;
}

// ─────────────────────────────────────────────────────────────────────
// Section 3 · ACT — placeholder with tab pills only
//   PR 5 wires the Claude tab; PR 6 the Draft tab; PR 7 the Decide tab.
// ─────────────────────────────────────────────────────────────────────

type ActTab = "claude" | "draft" | "decide";

function Section3Act({ item }: { item: S2DItem }) {
  const [tab, setTab] = useState<ActTab>(defaultTabForPathway(item.pathway));
  return (
    <SectionShell number={3} title="Act" tagline="do the work">
      <div className="flex items-center gap-1.5 rounded-md border border-border/40 bg-secondary/30 p-1">
        <TabPill active={tab === "claude"} onClick={() => setTab("claude")} icon={<Bot className="h-3 w-3" />} label="Claude" />
        <TabPill active={tab === "draft"} onClick={() => setTab("draft")} icon={<Mail className="h-3 w-3" />} label="Draft" />
        <TabPill active={tab === "decide"} onClick={() => setTab("decide")} icon={<CheckSquare className="h-3 w-3" />} label="Decide" />
      </div>
      <div className="mt-2 rounded-md border border-dashed border-border/40 bg-secondary/20 p-3 text-[11px] text-muted-foreground">
        {tab === "claude" && "Hand off to Claude Desktop or Code with the enriched context baked in. PR 5."}
        {tab === "draft" && "Live preview of a drafted reply in your style. Copy or send via Gmail / Slack. PR 6."}
        {tab === "decide" && "Record the decision + optionally spin up a follow-up item. PR 7."}
      </div>
    </SectionShell>
  );
}

function defaultTabForPathway(pathway: S2DItem["pathway"]): ActTab {
  if (pathway === "quick_reply" || pathway === "drafted_response") return "draft";
  if (pathway === "decision_gate") return "decide";
  return "claude";
}

// ─────────────────────────────────────────────────────────────────────
// Section primitives
// ─────────────────────────────────────────────────────────────────────

function SectionShell({
  number,
  title,
  tagline,
  collapsible,
  open,
  onToggle,
  headerRight,
  children,
}: {
  number: number;
  title: string;
  tagline?: string;
  collapsible?: boolean;
  open?: boolean;
  onToggle?: () => void;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border border-border/40 bg-card/55">
      <header
        className={cn(
          "flex items-center gap-2 px-2.5 py-1.5",
          collapsible && "cursor-pointer select-none"
        )}
        onClick={collapsible ? onToggle : undefined}
        role={collapsible ? "button" : undefined}
        aria-expanded={collapsible ? open : undefined}
      >
        <span className="font-mono text-[10px] font-bold text-primary">{number}</span>
        {collapsible && (
          <span className="text-muted-foreground/80">
            {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </span>
        )}
        <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground">
          {title}
        </span>
        {tagline && (
          <span className="text-[10px] text-muted-foreground">· {tagline}</span>
        )}
        {headerRight && (
          <span className="ml-auto" onClick={(e) => e.stopPropagation()}>
            {headerRight}
          </span>
        )}
      </header>
      {(!collapsible || open) && <div className="border-t border-border/30 p-2.5">{children}</div>}
    </section>
  );
}

function TabPill({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex h-auto items-center gap-1 rounded px-2 py-1 text-[11px] font-normal transition-colors",
        active
          ? "bg-primary text-primary-foreground hover:bg-primary/95 hover:text-primary-foreground"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {icon}
      {label}
    </Button>
  );
}

