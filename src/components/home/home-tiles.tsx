"use client";

// translucency-audit-ok: file — legacy callsites, migrate to sanctioned scale (/15, /40, /55, /60, /80, /95) case-by-case during component touch-ups.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  Calendar,
  CheckCircle2,
  Clock,
  Inbox,
  Loader2,
  RefreshCw,
  Send,
  Sparkles,
  Zap,
  X,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { SourceIcon } from "@/components/shared/source-icon";
import { PathwayBadge } from "@/components/shared/pathway-badge";
import { PriorityDot } from "@/components/shared/priority-dot";
import type { Company, S2DItem } from "@/types";
import { PRIORITY_META } from "@/types";
import { useAppStore } from "@/store/app-store";
import { useS2DStore } from "@/store/s2d-store";
import { useUpdateS2DItem } from "@/hooks/use-s2d";
import type { CalendarEventRow } from "@/hooks/use-calendar";
import { cn } from "@/lib/utils";

// ============================================================================
// Shared bits
// ============================================================================

function TileHeader({
  icon,
  title,
  right,
}: {
  icon: React.ReactNode;
  title: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex shrink-0 items-center justify-between border-b border-border/30 px-3 py-1.5">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {icon}
        {title}
      </div>
      {right && <div className="flex items-center gap-1">{right}</div>}
    </div>
  );
}

/**
 * Tiny inline error row used by tiles that previously fire-and-forgot
 * mutations. Surfaces mutateAsync failures without taking over the tile.
 */
function TileError({ msg, onDismiss }: { msg: string; onDismiss: () => void }) {
  return (
    <div className="flex items-start gap-1.5 rounded border border-destructive/40 bg-destructive/10 p-1.5 text-[11px] text-destructive">
      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
      <span className="flex-1">{msg}</span>
      <button
        onClick={onDismiss}
        className="text-muted-foreground hover:text-foreground"
        aria-label="Dismiss"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

function pickNow(items: S2DItem[]): S2DItem | null {
  const rank: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
  const active = items.filter(
    (i) => i.status !== "done" && i.status !== "in_queue"
  );
  if (active.length === 0) return null;
  return [...active].sort((a, b) => {
    const r = (rank[a.priority] ?? 9) - (rank[b.priority] ?? 9);
    if (r !== 0) return r;
    return b.updated_at.localeCompare(a.updated_at);
  })[0];
}

function pathwayActionLabel(p: S2DItem["pathway"]): string {
  switch (p) {
    case "quick_reply":
    case "drafted_response":
      return "Open draft";
    case "decision_gate":
      return "Decide";
    case "delegated":
      return "Track handoff";
    case "watching":
      return "Set reminder";
    case "heads_down":
      return "Start now";
    case "meeting_backed":
      return "Mark queued";
    default:
      return "Open";
  }
}

// ============================================================================
// 1. Now Card — the one thing you should do right now
// ============================================================================

export function NowCard({
  items,
  loading,
}: {
  items: S2DItem[];
  loading: boolean;
}) {
  const setSelected = useS2DStore((s) => s.setSelectedItem);
  const router = useRouter();
  const update = useUpdateS2DItem();
  const [error, setError] = useState<string | null>(null);

  const now = useMemo(() => pickNow(items), [items]);

  function openInBoard() {
    if (!now) return;
    router.push("/s2d");
    setTimeout(() => setSelected(now.id), 50);
  }

  async function markDone() {
    if (!now) return;
    setError(null);
    try {
      await update.mutateAsync({
        id: now.id,
        patch: { status: "done", outcome: "Done from cockpit", resolved_via: "manual" },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't mark done");
    }
  }

  async function snoozeTomorrow() {
    if (!now) return;
    setError(null);
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    try {
      await update.mutateAsync({
        id: now.id,
        patch: {
          status: "in_queue",
          snoozed_until: d.toISOString(),
          queue_reason: "Snoozed until tomorrow",
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't snooze");
    }
  }

  return (
    <>
      <TileHeader
        icon={<Sparkles className="h-3 w-3 text-primary" />}
        title="Now — your single move"
        right={
          now && (
            <span className="font-mono text-[10px] text-muted-foreground">
              MASH-{now.ticket_number}
            </span>
          )
        }
      />
      <div className="flex flex-1 flex-col gap-3 p-4">
        {error && <TileError msg={error} onDismiss={() => setError(null)} />}
        {loading ? (
          <Skeleton className="h-full w-full" />
        ) : !now ? (
          <div className="flex flex-1 items-center justify-center text-center text-sm text-muted-foreground">
            Nothing on deck. Enjoy the quiet — or pull from backlog.
          </div>
        ) : (
          <>
            <div className="flex items-start gap-2">
              <PriorityDot priority={now.priority} className="mt-1.5" />
              <div className="min-w-0 flex-1">
                <div className="text-base font-semibold leading-snug">
                  {now.title}
                </div>
                {now.description && (
                  <div className="mt-1 line-clamp-2 text-[12px] text-muted-foreground">
                    {now.description}
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <PathwayBadge pathway={now.pathway} />
              <span className="rounded border border-border/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                {PRIORITY_META[now.priority].label}
              </span>
              {now.est_minutes != null && (
                <span className="rounded border border-border/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                  {now.est_minutes}m
                </span>
              )}
              {now.source_type && <SourceIcon type={now.source_type} />}
            </div>

            <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-2">
              <Button size="sm" onClick={openInBoard} className="gap-1.5">
                <ArrowRight className="h-3.5 w-3.5" />
                {pathwayActionLabel(now.pathway)}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={markDone}
                className="gap-1.5"
              >
                <Check className="h-3.5 w-3.5" />
                Done
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={snoozeTomorrow}
                className="gap-1.5 text-muted-foreground"
              >
                <Clock className="h-3.5 w-3.5" />
                Snooze
              </Button>
            </div>
          </>
        )}
      </div>
    </>
  );
}

// ============================================================================
// 2. AI Command — natural-language commander that routes to chat panel
// ============================================================================

const COMMAND_TEMPLATES = [
  "Run triage + reconcile now",
  "Close everything done elsewhere",
  "What should I do next?",
  "Draft replies for every quick_reply",
];

export function AiCommandTile() {
  const setChatOpen = useAppStore((s) => s.setChatOpen);
  const [text, setText] = useState("");
  const [running, setRunning] = useState<"reconcile" | "consolidate" | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  function dispatchToChat(seed: string) {
    setChatOpen(true);
    window.dispatchEvent(new CustomEvent("mashi:seed-chat", { detail: seed }));
  }

  function submit() {
    const t = text.trim();
    if (!t) return;
    dispatchToChat(t);
    setText("");
  }

  async function runPass(kind: "reconcile" | "consolidate") {
    if (running) return;
    setRunning(kind);
    setToast(null);
    try {
      const endpoint =
        kind === "reconcile" ? "/api/reconcile" : "/api/consolidate";
      const res = await fetch(endpoint, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        const n = kind === "reconcile" ? data.total ?? 0 : data.merged ?? 0;
        setToast(`${kind} done — ${n} ${kind === "reconcile" ? "closed" : "merged"}`);
      } else {
        setToast(`${kind} failed`);
      }
    } catch {
      setToast(`${kind} errored`);
    } finally {
      setRunning(null);
      setTimeout(() => setToast(null), 4000);
    }
  }

  return (
    <>
      <TileHeader
        icon={<Sparkles className="h-3 w-3 text-primary" />}
        title="Mashi command"
        right={
          <button
            onClick={() => runPass("reconcile")}
            disabled={running != null}
            className="inline-flex items-center gap-1 rounded border border-border/40 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
            title="Re-run reconcile pass"
          >
            {running === "reconcile" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            Re-brief
          </button>
        }
      />
      <div className="flex flex-1 flex-col gap-2 p-3">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Ask Mashi to do anything across the board…"
          rows={2}
          className="min-h-16 resize-none text-[13px]"
        />
        <div className="flex flex-wrap gap-1">
          {COMMAND_TEMPLATES.map((t) => (
            <button
              key={t}
              onClick={() => dispatchToChat(t)}
              className="rounded-full border border-border/50 bg-secondary/40 px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              {t}
            </button>
          ))}
        </div>
        <div className="mt-auto flex items-center justify-between">
          <button
            onClick={() => runPass("consolidate")}
            disabled={running != null}
            className="text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            {running === "consolidate" ? "Consolidating…" : "Consolidate dupes"}
          </button>
          <Button size="sm" onClick={submit} disabled={!text.trim()} className="gap-1.5 h-7">
            <ArrowRight className="h-3.5 w-3.5" />
            Send
          </Button>
        </div>
        {toast && (
          <div className="text-[10px] text-primary">{toast}</div>
        )}
      </div>
    </>
  );
}

// ============================================================================
// 3. Sprint Launcher — pick mode, auto-select items, drop into planner
// ============================================================================

// SprintLauncherTile intentionally removed (2026-05). Sprint planning has
// been consolidated to two entry points: the "Plan sprint" button at the
// top-right of the /s2d board and the sidebar nav link. Multiple entry
// points fragmented the mental model and made it unclear where the
// canonical "start a sprint" action lived.

// ============================================================================
// 4. Review Queue — needs_review items pending swipe approval
// ============================================================================

export function ReviewQueueTile({ items }: { items: S2DItem[] }) {
  const router = useRouter();
  // needs_review is the AI-triaged-but-not-yet-approved flag. We don't
  // filter by companyFilter here because review is global — Sidd's daily
  // discipline is "clear the queue" not "clear the queue for one portco."
  const pending = items.filter((i) => i.needs_review && i.status !== "done");

  return (
    <>
      <TileHeader
        icon={<Inbox className="h-3 w-3 text-primary" />}
        title="Review queue"
      />
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-3 text-center">
        <div className="font-mono text-3xl tabular-nums">{pending.length}</div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          items pending approval
        </div>
        <Button
          size="sm"
          onClick={() => router.push("/s2d?review=1")}
          disabled={pending.length === 0}
          className="mt-1 h-7 gap-1.5"
        >
          <ArrowRight className="h-3 w-3" />
          Start swipe deck
        </Button>
      </div>
    </>
  );
}

// ============================================================================
// 5. Updates — inline notifications (unrolled, top 5)
// ============================================================================

export function UpdatesTile({ items }: { items: S2DItem[] }) {
  const setSelected = useS2DStore((s) => s.setSelectedItem);
  const router = useRouter();
  const update = useUpdateS2DItem();
  const [error, setError] = useState<string | null>(null);

  const unseen = items
    .filter((i) => i.has_unseen_updates && i.status !== "done")
    .sort((a, b) =>
      (b.last_update_at ?? b.updated_at).localeCompare(
        a.last_update_at ?? a.updated_at
      )
    );

  function open(id: string) {
    router.push("/s2d");
    setTimeout(() => setSelected(id), 50);
  }

  async function markRead(id: string) {
    setError(null);
    try {
      await update.mutateAsync({ id, patch: { has_unseen_updates: false } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't mark read");
    }
  }

  return (
    <>
      <TileHeader
        icon={<Bell className="h-3 w-3 text-primary" />}
        title="Updates"
        right={
          unseen.length > 0 && (
            <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-semibold text-primary">
              {unseen.length}
            </span>
          )
        }
      />
      {error && (
        <div className="px-3 pt-2">
          <TileError msg={error} onDismiss={() => setError(null)} />
        </div>
      )}
      {unseen.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-center text-[12px] text-muted-foreground">
          All caught up.
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <ul className="divide-y divide-border/30">
            {unseen.slice(0, 5).map((it) => (
              <li
                key={it.id}
                className="group flex items-start gap-2 px-3 py-2 hover:bg-accent/30"
              >
                <button
                  onClick={() => open(it.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="line-clamp-1 text-[12px] font-medium">{it.title}</div>
                  {it.last_update_summary && (
                    <div className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">
                      {it.last_update_summary}
                    </div>
                  )}
                </button>
                <button
                  onClick={() => markRead(it.id)}
                  className="opacity-0 transition-opacity group-hover:opacity-100"
                  title="Mark read"
                >
                  <X className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                </button>
              </li>
            ))}
          </ul>
        </ScrollArea>
      )}
    </>
  );
}

// ============================================================================
// 6. Calendar Strip — today's meetings + meeting-backed prep items underneath
// ============================================================================

export function CalendarStripTile({
  events,
  items,
}: {
  events: CalendarEventRow[];
  items: S2DItem[];
}) {
  const router = useRouter();
  const setSelected = useS2DStore((s) => s.setSelectedItem);
  const [expanded, setExpanded] = useState<string | null>(null);

  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const todayEnd = todayStart + 86_400_000;

  const todays = events
    .filter((e) => {
      const t = new Date(e.start_at).getTime();
      return t >= todayStart && t < todayEnd;
    })
    .sort((a, b) => a.start_at.localeCompare(b.start_at));

  const prepItems = items.filter(
    (i) => i.pathway === "meeting_backed" && i.status !== "done"
  );

  function openItem(id: string) {
    router.push("/s2d");
    setTimeout(() => setSelected(id), 50);
  }

  return (
    <>
      <TileHeader
        icon={<Calendar className="h-3 w-3 text-primary" />}
        title="Today"
        right={
          <span className="text-[10px] text-muted-foreground">
            {todays.length} meeting{todays.length === 1 ? "" : "s"}
          </span>
        }
      />
      {todays.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-center text-[12px] text-muted-foreground">
          No meetings today.
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <ul className="divide-y divide-border/30">
            {todays.map((e) => {
              const isExpanded = expanded === e.id;
              // Naive matching: prep items whose company matches the event's
              // company. Good enough until we wire meeting_id directly.
              const prep = prepItems.filter(
                (p) => p.company_id && p.company_id === e.company_id
              );
              const t = new Date(e.start_at);
              const hh = t.getHours().toString().padStart(2, "0");
              const mm = t.getMinutes().toString().padStart(2, "0");
              return (
                <li key={e.id}>
                  <button
                    onClick={() => setExpanded(isExpanded ? null : e.id)}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-accent/30"
                  >
                    <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                      {hh}:{mm}
                    </span>
                    <span className="line-clamp-1 flex-1 text-[12px]">{e.title}</span>
                    {prep.length > 0 && (
                      <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-semibold text-primary">
                        {prep.length} prep
                      </span>
                    )}
                  </button>
                  {isExpanded && prep.length > 0 && (
                    <ul className="bg-secondary/20 pb-1">
                      {prep.map((p) => (
                        <li key={p.id}>
                          <button
                            onClick={() => openItem(p.id)}
                            className="flex w-full items-center gap-2 px-5 py-1 text-left text-[11px] text-muted-foreground hover:bg-accent/40 hover:text-foreground"
                          >
                            <PriorityDot priority={p.priority} />
                            <span className="line-clamp-1 flex-1">{p.title}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </ScrollArea>
      )}
    </>
  );
}

// ============================================================================
// 7. Quick-knock — every quick_reply item, send inline
// ============================================================================

export function QuickKnockTile({ items }: { items: S2DItem[] }) {
  const setSelected = useS2DStore((s) => s.setSelectedItem);
  const router = useRouter();

  const quick = items.filter(
    (i) => i.pathway === "quick_reply" && i.status !== "done"
  );

  function open(id: string) {
    router.push("/s2d");
    setTimeout(() => setSelected(id), 50);
  }

  return (
    <>
      <TileHeader
        icon={<Zap className="h-3 w-3 text-primary" />}
        title="Quick-knock lane"
        right={
          <span className="text-[10px] text-muted-foreground">
            {quick.length} item{quick.length === 1 ? "" : "s"}
          </span>
        }
      />
      {quick.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-center text-[12px] text-muted-foreground">
          No quick replies queued.
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <ul className="divide-y divide-border/30">
            {quick.map((it) => (
              <li
                key={it.id}
                className="flex items-center gap-2 px-3 py-1.5 hover:bg-accent/30"
              >
                {it.source_type && <SourceIcon type={it.source_type} />}
                <button
                  onClick={() => open(it.id)}
                  className="line-clamp-1 min-w-0 flex-1 text-left text-[12px]"
                >
                  {it.title}
                </button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 gap-1 px-2 text-[10px]"
                  onClick={() => open(it.id)}
                >
                  <Send className="h-3 w-3" />
                  Draft
                </Button>
              </li>
            ))}
          </ul>
        </ScrollArea>
      )}
    </>
  );
}

// ============================================================================
// 8. Waiting on others — in_queue with inline nudge / close
// ============================================================================

export function WaitingTile({ items }: { items: S2DItem[] }) {
  const router = useRouter();
  const setSelected = useS2DStore((s) => s.setSelectedItem);
  const update = useUpdateS2DItem();
  const [error, setError] = useState<string | null>(null);

  const waiting = items.filter((i) => i.status === "in_queue");

  function open(id: string) {
    router.push("/s2d");
    setTimeout(() => setSelected(id), 50);
  }

  async function closeIt(id: string) {
    setError(null);
    try {
      await update.mutateAsync({
        id,
        patch: {
          status: "done",
          outcome: "Closed from cockpit, happened",
          resolved_via: "manual",
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't close");
    }
  }

  return (
    <>
      <TileHeader
        icon={<Clock className="h-3 w-3 text-muted-foreground" />}
        title="Waiting on others"
        right={
          <span className="text-[10px] text-muted-foreground">
            {waiting.length}
          </span>
        }
      />
      {error && (
        <div className="px-3 pt-2">
          <TileError msg={error} onDismiss={() => setError(null)} />
        </div>
      )}
      {waiting.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-center text-[12px] text-muted-foreground">
          Nothing in queue.
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <ul className="divide-y divide-border/30">
            {waiting.map((it) => (
              <li
                key={it.id}
                className="group flex items-center gap-2 px-3 py-1.5 hover:bg-accent/30"
              >
                <button
                  onClick={() => open(it.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="line-clamp-1 text-[12px]">{it.title}</div>
                  {it.queue_reason && (
                    <div className="line-clamp-1 text-[10px] text-muted-foreground">
                      {it.queue_reason}
                    </div>
                  )}
                </button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => closeIt(it.id)}
                  className="h-6 gap-1 px-2 text-[10px] opacity-0 transition-opacity group-hover:opacity-100"
                  title="Mark resolved"
                >
                  <CheckCircle2 className="h-3 w-3" />
                  Close
                </Button>
              </li>
            ))}
          </ul>
        </ScrollArea>
      )}
    </>
  );
}

// ============================================================================
// 9. Portfolio mini-grid — click to cross-filter the cockpit
// ============================================================================

export function PortfolioTile({
  companies,
  items,
  active,
  onToggle,
}: {
  companies: Company[];
  items: S2DItem[];
  active: string | null;
  onToggle: (id: string) => void;
}) {
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of items) {
      if (!i.company_id || i.status === "done") continue;
      m.set(i.company_id, (m.get(i.company_id) ?? 0) + 1);
    }
    return m;
  }, [items]);

  const sorted = [...companies]
    .map((c) => ({ ...c, open: counts.get(c.id) ?? 0 }))
    .sort((a, b) => b.open - a.open);

  return (
    <>
      <TileHeader
        icon={<AlertTriangle className="h-3 w-3 text-muted-foreground" />}
        title="Portfolio"
        right={
          <Link
            href="/companies"
            className="text-[10px] text-muted-foreground hover:text-foreground"
          >
            all →
          </Link>
        }
      />
      <ScrollArea className="flex-1">
        <ul className="divide-y divide-border/30">
          {sorted.map((c) => (
            <li key={c.id}>
              <button
                onClick={() => onToggle(c.id)}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-accent/30",
                  active === c.id && "bg-primary/10"
                )}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: c.color_hex }}
                />
                <span className="flex-1 truncate text-[12px]">{c.name}</span>
                <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                  {c.open}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </ScrollArea>
    </>
  );
}
