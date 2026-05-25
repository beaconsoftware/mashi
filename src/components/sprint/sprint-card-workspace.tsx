"use client";

// translucency-audit-ok: file — sprint card chrome composed of sanctioned /15 + /55 + /80 surfaces, see AGENTS.md.

import { useEffect, useMemo, useRef, useState } from "react";
import {
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
  Sparkles,
  Lightbulb,
} from "lucide-react";
import { useGSAP } from "@gsap/react";
import { gsap, DUR, EASE, withMotion } from "@/lib/animation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
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
import type { S2DItem } from "@/types";

/**
 * Sprint Card v3 — Sources Rail + Workspace.
 *
 * Replaces the vertical four-section accordion. The card body is now a
 * two-column workspace:
 *
 *   ┌──────────────┬─────────────────────────────────────┐
 *   │ SOURCES      │ [Plan] [Claude] [Draft] [Decide]    │
 *   │              │                                     │
 *   │ summary      │  active tab's body                  │
 *   │ + enrich     │  (each tab owns its own scroll)     │
 *   │ + pulled     │                                     │
 *   │ + cached     │                                     │
 *   └──────────────┴─────────────────────────────────────┘
 *
 * Why: the prior layout's accordion put artifacts (pinned sources) and
 * consumers (Draft preview, Claude prompt) 600px apart in a 480px
 * viewport. A persistent rail keeps Enrich's output ambient while the
 * workspace stays purely about the active verb. Each column owns ONE
 * scroll region — the outer card never scrolls, which fixes the prior
 * "can't scroll the card body" bug.
 *
 * Both columns must live inside a parent that supplies `min-h-0`. The
 * parent SlotCard already does this; if you embed this elsewhere, make
 * the parent flex with min-h-0 so the inner scrollers can clamp.
 */
interface Props {
  item: S2DItem;
  /**
   * When the slot is benched / queued, suppress any expensive
   * fetches inside subcomponents.
   */
  active?: boolean;
}

export function SprintCardWorkspace({ item, active = true }: Props) {
  return (
    <div className="flex h-full min-h-0 gap-3 overflow-hidden">
      <SourcesRail item={item} active={active} />
      <Workspace item={item} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Sources rail (left, 200px) — ambient context. Stays visible while you
// work on the right. One scroll region.
// ─────────────────────────────────────────────────────────────────────

function SourcesRail({ item, active }: { item: S2DItem; active: boolean }) {
  const { data, isLoading: reading } = useEnrichedContext(item.id);
  const run = useRunEnrich(item.id);
  const ctx = data?.enriched_context ?? null;
  const hasEnrich = !!ctx && ctx.pulled_sources.length > 0;
  const busy = run.isPending;
  const error = run.error;

  return (
    <aside className="relative flex w-[200px] shrink-0 flex-col rounded-md border border-border/40 bg-card/55">
      {/* Item summary at the top — what this card is about, in 3 lines. */}
      <header className="shrink-0 border-b border-border/30 px-3 py-2.5">
        <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          <Sparkles className="h-3 w-3 text-primary" />
          About
        </div>
        <p className="line-clamp-3 text-[11px] leading-snug text-foreground/90">
          {item.description?.trim() || "No description yet — open Detail to add one."}
        </p>
      </header>

      {/* Enrich control — always visible so discovery is one click. */}
      <div className="shrink-0 border-b border-border/30 px-2 py-2">
        <Button
          type="button"
          size="sm"
          onClick={() => run.mutate(undefined)}
          disabled={busy || reading}
          className="h-7 w-full gap-1.5 px-2 text-[11px]"
          variant={hasEnrich ? "outline" : "default"}
          title={
            hasEnrich
              ? "Re-run enrich (replaces plan + non-pinned sources)"
              : "Pull related items, messages, meetings, and Linear issues; build a 3-step plan"
          }
        >
          {busy ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : hasEnrich ? (
            <RefreshCw className="h-3 w-3" />
          ) : (
            <Wand2 className="h-3 w-3" />
          )}
          {busy ? "Enriching" : hasEnrich ? "Re-enrich" : "Run Enrich"}
        </Button>
        {hasEnrich && ctx?.last_enriched_at && (
          <div className="mt-1 text-center text-[9px] text-muted-foreground/70">
            {labelFromTimestamp(ctx.last_enriched_at)}
          </div>
        )}
        {error && (
          <div className="mt-1 rounded border border-destructive/40 bg-destructive/10 px-1.5 py-1 text-[10px] text-destructive">
            {error instanceof Error ? error.message : String(error)}
          </div>
        )}
      </div>

      {/* Source list — scrolls. Pulled sources first (pinned ones float),
          then cached sources below. */}
      <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2">
        {hasEnrich && ctx ? (
          <PulledSources sources={ctx.pulled_sources} itemId={item.id} />
        ) : (
          <div className="rounded border border-dashed border-border/40 px-2 py-3 text-[10px] leading-snug text-muted-foreground/80">
            Run Enrich to surface related items, recent messages, meetings,
            and Linear issues — they&apos;ll appear here.
          </div>
        )}

        {active && (
          <div className="mt-3">
            <RailSectionHeader>About this item</RailSectionHeader>
            <div className="mt-1.5">
              <SprintItemContext item={item} enabled />
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

function RailSectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/80">
      {children}
    </div>
  );
}

/**
 * Pulled-source list with in-place pin / unpin. Pinned sources sort to
 * the top so they're co-visible with whichever tab the user is on.
 * Each row animates in on mount (slot promotes / enrich completes) for
 * a calmer "items arriving" feel.
 */
function PulledSources({
  sources,
  itemId,
}: {
  sources: EnrichPulledSource[];
  itemId: string;
}) {
  const pin = usePinSource(itemId);
  // Pinned first, then by original order (recency from the agent).
  const sorted = useMemo(
    () => [...sources].sort((a, b) => Number(b.pinned) - Number(a.pinned)),
    [sources]
  );

  if (sorted.length === 0) {
    return (
      <div className="rounded border border-dashed border-border/40 px-2 py-2 text-[10px] text-muted-foreground/80">
        Enrich found no related sources for this item.
      </div>
    );
  }

  return (
    <>
      <RailSectionHeader>
        Pulled context{" "}
        <span className="font-normal normal-case tracking-normal text-muted-foreground/60">
          · {sorted.filter((s) => s.pinned).length} pinned
        </span>
      </RailSectionHeader>
      <ul className="mt-1.5 space-y-1.5">
        {sorted.map((s) => (
          <PulledSourceRow
            key={`${s.kind}:${s.ref}`}
            source={s}
            onTogglePin={() =>
              pin.mutate({ source: { kind: s.kind, ref: s.ref }, pinned: !s.pinned })
            }
          />
        ))}
      </ul>
    </>
  );
}

function PulledSourceRow({
  source,
  onTogglePin,
}: {
  source: EnrichPulledSource;
  onTogglePin: () => void;
}) {
  // Mount-in animation: each row fades + slides up a touch. Wrapped in
  // withMotion so prefers-reduced-motion users skip it. The animation
  // re-fires whenever React key changes, i.e., enrich pulls fresh hits.
  const rootRef = useRef<HTMLLIElement | null>(null);
  useGSAP(
    () => {
      if (!rootRef.current) return;
      withMotion(() => {
        gsap.fromTo(
          rootRef.current,
          { opacity: 0, y: 4 },
          {
            opacity: 1,
            y: 0,
            duration: DUR.short,
            ease: EASE.out,
            clearProps: "all",
          }
        );
      });
    },
    { scope: rootRef }
  );

  return (
    <li
      ref={rootRef}
      className={cn(
        "group/source flex items-start gap-1.5 rounded border px-1.5 py-1.5 text-[11px] transition-colors",
        source.pinned
          ? "border-primary/40 bg-primary/8 hover:border-primary/60"
          : "border-border/30 bg-card/40 hover:border-border/60 hover:bg-card/70"
      )}
    >
      <SourceKindIcon kind={source.kind} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] font-medium leading-tight text-foreground/90">
          {source.label}
        </div>
        {source.when && (
          <div className="mt-0.5 font-mono text-[9px] text-muted-foreground/70">
            {source.when.slice(0, 10)}
          </div>
        )}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onTogglePin}
        aria-pressed={source.pinned}
        aria-label={source.pinned ? "Unpin source" : "Pin source"}
        title={
          source.pinned
            ? "Unpin — drops from future refine + downstream actions"
            : "Pin — keeps this source across refine + feeds Claude / Draft"
        }
        className={cn(
          "mashi-press h-6 w-6 shrink-0",
          source.pinned
            ? "text-primary hover:bg-primary/15"
            : "text-muted-foreground/40 opacity-0 group-hover/source:opacity-100 hover:bg-accent hover:text-foreground"
        )}
      >
        {source.pinned ? <Pin className="h-3 w-3" /> : <PinOff className="h-3 w-3" />}
      </Button>
    </li>
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

function labelFromTimestamp(iso: string | null | undefined): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "enriched just now";
  if (ms < 60 * 60_000) return `enriched ${Math.round(ms / 60_000)}m ago`;
  if (ms < 24 * 60 * 60_000) return `enriched ${Math.round(ms / 3_600_000)}h ago`;
  return `enriched ${new Date(iso).toISOString().slice(0, 10)}`;
}

// ─────────────────────────────────────────────────────────────────────
// Workspace (right, flex-1) — shadcn Tabs. The active verb.
// ─────────────────────────────────────────────────────────────────────

type WorkspaceTab = "plan" | "claude" | "draft" | "decide";

function Workspace({ item }: { item: S2DItem }) {
  const [tab, setTab] = useState<WorkspaceTab>(defaultTabForPathway(item.pathway));

  // Re-route default tab when the slot promotes a new queued item with
  // a different pathway — without this, swapping from a heads_down item
  // to a quick_reply item would land on the wrong default.
  useEffect(() => {
    setTab(defaultTabForPathway(item.pathway));
  }, [item.id, item.pathway]);

  return (
    <Tabs
      value={tab}
      onValueChange={(v) => setTab(v as WorkspaceTab)}
      className="flex flex-1 min-w-0 min-h-0 flex-col"
    >
      <TabsList className="h-8 shrink-0 rounded-md bg-secondary/40 p-0.5">
        <TabsTrigger
          value="plan"
          className="h-7 gap-1.5 px-2.5 text-[11px] data-[state=active]:bg-card data-[state=active]:shadow-sm"
        >
          <Lightbulb className="h-3 w-3" />
          Plan
        </TabsTrigger>
        <TabsTrigger
          value="claude"
          className="h-7 gap-1.5 px-2.5 text-[11px] data-[state=active]:bg-card data-[state=active]:shadow-sm"
        >
          <Bot className="h-3 w-3" />
          Claude
        </TabsTrigger>
        <TabsTrigger
          value="draft"
          className="h-7 gap-1.5 px-2.5 text-[11px] data-[state=active]:bg-card data-[state=active]:shadow-sm"
        >
          <Mail className="h-3 w-3" />
          Draft
        </TabsTrigger>
        <TabsTrigger
          value="decide"
          className="h-7 gap-1.5 px-2.5 text-[11px] data-[state=active]:bg-card data-[state=active]:shadow-sm"
        >
          <CheckSquare className="h-3 w-3" />
          Decide
        </TabsTrigger>
      </TabsList>

      <TabsContent value="plan" className="mt-2 flex-1 min-h-0 overflow-y-auto pr-1 outline-none">
        <PlanPanel item={item} />
      </TabsContent>
      <TabsContent value="claude" className="mt-2 flex-1 min-h-0 overflow-y-auto pr-1 outline-none">
        <ClaudePanel item={item} />
      </TabsContent>
      <TabsContent value="draft" className="mt-2 flex-1 min-h-0 overflow-y-auto pr-1 outline-none">
        <DraftPanel item={item} />
      </TabsContent>
      <TabsContent value="decide" className="mt-2 flex-1 min-h-0 overflow-y-auto pr-1 outline-none">
        <DecidePanel item={item} />
      </TabsContent>
    </Tabs>
  );
}

function defaultTabForPathway(pathway: S2DItem["pathway"]): WorkspaceTab {
  if (pathway === "quick_reply" || pathway === "drafted_response") return "draft";
  if (pathway === "decision_gate") return "decide";
  return "plan";
}

// ─────────────────────────────────────────────────────────────────────
// Plan tab — the 3-step plan + refine chat thread. Sources do NOT
// render here; they're ambient on the rail.
// ─────────────────────────────────────────────────────────────────────

function PlanPanel({ item }: { item: S2DItem }) {
  const { data } = useEnrichedContext(item.id);
  const ctx = data?.enriched_context ?? null;
  const hasPlan = !!ctx && ctx.plan.length > 0;
  const hasThread = !!ctx && ctx.thread.length > 0;
  const initialAssistant = ctx?.thread.find((t) => t.role === "assistant");

  if (!hasPlan && !hasThread) {
    return (
      <div className="rounded-md border border-dashed border-border/40 bg-card/40 p-4 text-[11px] leading-snug text-muted-foreground">
        Run Enrich on the left to pull related context and build a 3-step
        plan for this item. The plan and a refine chat will land here.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {hasPlan && (
        <section className="rounded-md border border-border/40 bg-card/60 p-3">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Plan
          </div>
          <ol className="space-y-1.5 text-[12px] leading-snug text-foreground/95">
            {ctx!.plan.map((step, i) => (
              <li key={i} className="flex gap-2.5">
                <span className="font-mono text-[10px] text-primary">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          {initialAssistant && (
            <p className="mt-2.5 border-t border-border/30 pt-2 text-[11px] leading-snug text-muted-foreground">
              {initialAssistant.content}
            </p>
          )}
        </section>
      )}

      <RefineThread thread={ctx?.thread ?? []} itemId={item.id} />
    </div>
  );
}

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

  // Skip the canonical first user/assistant pair — its assistant text
  // already renders as the "summary" line under the Plan above. We only
  // surface the actual refine turns the user typed.
  const refineTurns = thread.slice(2);
  const visible = showAll ? refineTurns : refineTurns.slice(-2);
  const hiddenCount = refineTurns.length - visible.length;

  async function handleSend() {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    try {
      await run.mutateAsync(text);
    } catch {
      setDraft(text);
    }
    composerRef.current?.focus();
  }

  return (
    <section className="rounded-md border border-border/40 bg-card/60 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Refine
        {hiddenCount > 0 && !showAll && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => setShowAll(true)}
            className="h-auto px-1 py-0 text-[10px] font-normal tracking-normal text-muted-foreground hover:bg-transparent hover:text-foreground"
          >
            · show {hiddenCount} earlier
          </Button>
        )}
      </div>
      {refineTurns.length > 0 && (
        <ul className="mb-2 space-y-1.5">
          {visible.map((turn, i) => (
            <RefineTurnRow key={`${turn.at}:${i}`} turn={turn} />
          ))}
        </ul>
      )}
      <div className="flex items-start gap-1.5">
        <Textarea
          ref={composerRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="Refine — find me examples from May, focus on Linear only…"
          rows={2}
          className="min-h-0 resize-none rounded-md border-border/40 bg-card/80 px-2 py-1.5 text-[11px] leading-snug placeholder:text-muted-foreground/60"
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
    </section>
  );
}

function RefineTurnRow({ turn }: { turn: EnrichThreadTurn }) {
  const rootRef = useRef<HTMLLIElement | null>(null);
  useGSAP(
    () => {
      if (!rootRef.current) return;
      withMotion(() => {
        gsap.fromTo(
          rootRef.current,
          { opacity: 0, y: 4 },
          { opacity: 1, y: 0, duration: DUR.short, ease: EASE.out, clearProps: "all" }
        );
      });
    },
    { scope: rootRef }
  );
  return (
    <li
      ref={rootRef}
      className={cn(
        "rounded-md border px-2 py-1.5 text-[11px] leading-snug",
        turn.role === "user"
          ? "border-border/30 bg-secondary/40 text-foreground/90"
          : "border-primary/30 bg-primary/5 text-muted-foreground"
      )}
    >
      <div className="mb-0.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">
        {turn.role === "user" ? "you" : "mashi"}
      </div>
      {turn.content}
    </li>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Claude tab — single canonical home for Claude handoff.
// Reads pinned sources implicitly through the existing prompt builder.
// ─────────────────────────────────────────────────────────────────────

function ClaudePanel({ item }: { item: S2DItem }) {
  const { data } = useEnrichedContext(item.id);
  const ctx = data?.enriched_context ?? null;
  const pinnedCount = ctx?.pulled_sources.filter((s) => s.pinned).length ?? 0;
  const [working, setWorking] = useState(false);
  const [copied, setCopied] = useState<"web" | "code" | "copy" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function packAndDispatch(target: "web" | "code" | "copy") {
    if (working) return;
    setWorking(true);
    setError(null);
    try {
      const { fetchAndRenderClaudePrompt } = await import("@/lib/s2d/claude-prompt");
      const { renderEnrichedContextBlock } = await import("@/lib/s2d/enriched-prompt");
      const base = await fetchAndRenderClaudePrompt(item);
      const enriched = renderEnrichedContextBlock(ctx);
      const text = enriched ? `${base}\n\n${enriched}` : base;
      await navigator.clipboard.writeText(text);
      setCopied(target);
      setTimeout(() => setCopied(null), 1800);
      if (target === "web") {
        window.open("https://claude.ai/new", "_blank", "noopener,noreferrer");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to build prompt");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="space-y-3">
      <section className="rounded-md border border-border/40 bg-card/60 p-3">
        <p className="text-[11px] leading-snug text-muted-foreground">
          Hand off with the full pack: cached sources from this item, plus your
          plan + pinned sources + refine thread.
        </p>
        {pinnedCount > 0 && (
          <p className="mt-1 text-[10px] text-primary/90">
            {pinnedCount} pinned source{pinnedCount === 1 ? "" : "s"} will be included.
          </p>
        )}
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            onClick={() => packAndDispatch("web")}
            disabled={working}
            className="h-7 gap-1.5 px-2.5 text-[11px]"
            title="Copy prompt and open claude.ai in a new tab"
          >
            {working && copied === null ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Bot className="h-3 w-3" />
            )}
            {copied === "web" ? "Copied → claude.ai" : "Open Claude Desktop"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => packAndDispatch("code")}
            disabled={working}
            className="h-7 gap-1.5 px-2.5 text-[11px]"
            title="Copy prompt for pasting into Claude Code"
          >
            <Bot className="h-3 w-3" />
            {copied === "code" ? "Copied" : "For Claude Code"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => packAndDispatch("copy")}
            disabled={working}
            className="h-7 gap-1.5 px-2.5 text-[11px] text-muted-foreground"
            title="Copy prompt to clipboard"
          >
            {copied === "copy" ? "Copied" : "Copy prompt"}
          </Button>
        </div>
        {error && <div className="mt-1 text-[10px] text-destructive">{error}</div>}
      </section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Draft tab — stream a reply using the existing action route.
// ─────────────────────────────────────────────────────────────────────

function DraftPanel({ item }: { item: S2DItem }) {
  const actionKey = draftActionKeyForPathway(item.pathway);
  const canSendInline =
    !!actionKey && (item.source_type === "gmail" || item.source_type === "slack");

  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamErr, setStreamErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setDraft("");
    setStreamErr(null);
    setToast(null);
    return () => abortRef.current?.abort();
  }, [item.id]);

  async function generate() {
    if (!actionKey) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setStreaming(true);
    setStreamErr(null);
    setDraft("");
    let acc = "";
    try {
      const { streamPostText } = await import("@/lib/streaming");
      await streamPostText(
        `/api/s2d/${item.id}/action`,
        { action: actionKey },
        (delta) => {
          acc += delta;
          setDraft(acc);
        },
        ctrl.signal
      );
    } catch (e) {
      if (!ctrl.signal.aborted) {
        setStreamErr(e instanceof Error ? e.message : "stream failed");
      }
    } finally {
      setStreaming(false);
    }
  }

  async function copyDraft() {
    if (!draft.trim()) return;
    await navigator.clipboard.writeText(draft);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function send() {
    if (!canSendInline || !draft.trim() || sending) return;
    setSending(true);
    setToast(null);
    try {
      const res = await fetch(`/api/s2d/${item.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: draft }),
      });
      const j = (await res.json()) as { ok?: boolean; message?: string; error?: string };
      if (!res.ok) setToast(j.error ?? `send failed (${res.status})`);
      else setToast(j.message ?? "Sent.");
    } catch (e) {
      setToast(e instanceof Error ? e.message : "send failed");
    } finally {
      setSending(false);
    }
  }

  if (!actionKey) {
    return (
      <div className="rounded-md border border-dashed border-border/40 bg-card/40 p-4 text-[11px] leading-snug text-muted-foreground">
        Draft isn&apos;t the natural action for {item.pathway.replace("_", " ")}{" "}
        items. Try Claude to hand this off, or Decide to record what you
        concluded.
      </div>
    );
  }

  const sendLabel =
    item.source_type === "gmail"
      ? "Send via Gmail"
      : item.source_type === "slack"
        ? "Send via Slack"
        : "Send";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Draft · {item.pathway.replace("_", " ")}
        </span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={generate}
          disabled={streaming}
          className="h-6 gap-1 px-2 text-[11px]"
          title="Generate (or re-generate) a streamed draft in your style"
        >
          {streaming ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          {streaming ? "Streaming" : draft ? "Re-stream" : "Generate draft"}
        </Button>
      </div>
      {!draft && !streaming && !streamErr && (
        <div className="rounded-md border border-dashed border-border/40 bg-card/40 p-3 text-[11px] text-muted-foreground">
          Click <em>Generate draft</em> to stream a reply in your voice.
          Pinned sources on the left feed the prompt.
        </div>
      )}
      {streamErr && (
        <div className="rounded border border-destructive/40 bg-destructive/10 p-2 text-[11px] text-destructive">
          {streamErr}
        </div>
      )}
      {(streaming || draft) && (
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={8}
          placeholder={streaming ? "Streaming…" : "Draft will appear here."}
          className="resize-none rounded-md border-border/40 bg-card/80 px-2.5 py-2 text-[12px] leading-snug"
        />
      )}
      {(streaming || draft) && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={copyDraft}
            disabled={!draft.trim()}
            className="h-7 gap-1.5 px-2 text-[11px]"
          >
            {copied ? "Copied" : "Copy"}
          </Button>
          {canSendInline && (
            <Button
              type="button"
              size="sm"
              onClick={send}
              disabled={sending || !draft.trim() || streaming}
              className="h-7 gap-1.5 px-2 text-[11px]"
              title={
                item.source_type === "gmail"
                  ? "Send as a Gmail reply on the source thread"
                  : "Send to the source Slack channel/DM"
              }
            >
              {sending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Send className="h-3 w-3" />
              )}
              {sending ? "Sending" : sendLabel}
            </Button>
          )}
          {!canSendInline && item.source_type && (
            <span className="text-[10px] text-muted-foreground/70">
              Inline send not available for {item.source_type}.
            </span>
          )}
        </div>
      )}
      {toast && <div className="text-[10px] text-muted-foreground">{toast}</div>}
    </div>
  );
}

function draftActionKeyForPathway(pathway: S2DItem["pathway"]): string | null {
  switch (pathway) {
    case "quick_reply":
      return "quick_reply_draft";
    case "drafted_response":
      return "drafted_response_prose";
    case "delegated":
      return "delegated_check_in";
    default:
      return null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Decide tab — record a decision + optional follow-up item.
// ─────────────────────────────────────────────────────────────────────

function DecidePanel({ item }: { item: S2DItem }) {
  const [note, setNote] = useState("");
  const [trackFollowUp, setTrackFollowUp] = useState(false);
  const [followUpText, setFollowUpText] = useState("");
  const [followUpDate, setFollowUpDate] = useState(defaultFollowUpDate());
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setNote("");
    setTrackFollowUp(false);
    setFollowUpText("");
    setFollowUpDate(defaultFollowUpDate());
    setSavedAt(null);
    setError(null);
  }, [item.id]);

  async function save() {
    if (!note.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const followUp =
        trackFollowUp && followUpText.trim() && followUpDate
          ? { text: followUpText.trim(), snooze_until: followUpDate }
          : undefined;
      const res = await fetch(`/api/s2d/${item.id}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          note: note.trim(),
          ...(followUp ? { follow_up: followUp } : {}),
        }),
      });
      const j = (await res.json()) as {
        ok?: boolean;
        error?: string;
        follow_up_id?: string;
        follow_up_error?: string;
      };
      if (!res.ok || !j.ok) {
        setError(j.error ?? `decide failed (${res.status})`);
        return;
      }
      setSavedAt(Date.now());
      if (j.follow_up_error) {
        setError(`Decision saved, but follow-up failed: ${j.follow_up_error}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "decide failed");
    } finally {
      setSaving(false);
    }
  }

  const justSaved = !!savedAt && Date.now() - savedAt < 4000;

  return (
    <div className="space-y-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        Decision
      </div>
      <Textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="What did you decide and why? (e.g. 'Going with option B — vendor lock-in risk on A outweighs the 2-week ship gain.')"
        rows={4}
        className="resize-none rounded-md border-border/40 bg-card/80 px-2.5 py-2 text-[12px] leading-snug placeholder:text-muted-foreground/60"
        disabled={saving}
      />

      <label className="flex items-start gap-2 text-[11px]">
        <Checkbox
          checked={trackFollowUp}
          onCheckedChange={(v) => setTrackFollowUp(v === true)}
          disabled={saving}
          className="mt-0.5"
        />
        <span>
          Track a follow-up{" "}
          <span className="text-muted-foreground">
            (creates a new item snoozed until the chosen date)
          </span>
        </span>
      </label>

      {trackFollowUp && (
        <div className="space-y-1.5 rounded-md border border-border/30 bg-secondary/20 p-2.5">
          <Textarea
            value={followUpText}
            onChange={(e) => setFollowUpText(e.target.value)}
            placeholder="What's the next concrete step? (e.g. 'Send vendor B contract to Legal for redline')"
            rows={2}
            className="resize-none rounded-md border-border/40 bg-card/80 px-2 py-1.5 text-[12px] leading-snug placeholder:text-muted-foreground/60"
            disabled={saving}
          />
          <div className="flex items-center gap-1.5 text-[11px]">
            <span className="text-muted-foreground">Resurface on</span>
            <Input
              type="date"
              value={followUpDate}
              onChange={(e) => setFollowUpDate(e.target.value)}
              disabled={saving}
              className="h-7 w-auto rounded border border-border/40 bg-card/80 px-1.5 py-0.5 text-[11px]"
            />
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          onClick={save}
          disabled={
            saving ||
            !note.trim() ||
            (trackFollowUp && (!followUpText.trim() || !followUpDate))
          }
          className="h-7 gap-1.5 px-2 text-[11px]"
        >
          {saving ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <CheckSquare className="h-3 w-3" />
          )}
          {saving ? "Saving" : "Save decision"}
        </Button>
        {justSaved && !error && (
          <span className="text-[10px] text-muted-foreground">
            Saved. Hit Done below when you&apos;re ready to close this out.
          </span>
        )}
        {error && <span className="text-[10px] text-destructive">{error}</span>}
      </div>
    </div>
  );
}

function defaultFollowUpDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}

// Re-export Separator type-import to silence the linter when only used
// in JSX (kept for future structural separators we might want to add).
export type { S2DItem };
void Separator;
