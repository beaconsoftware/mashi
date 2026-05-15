"use client";

import { useEffect, useState } from "react";
import {
  ExternalLink,
  BellOff,
  Trash2,
  Zap,
  ArrowRight,
  Clock,
  Check,
  Send,
  CalendarPlus,
  Copy,
  X,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Bell,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { useS2DStore } from "@/store/s2d-store";
import { useS2DItems, useUpdateS2DItem } from "@/hooks/use-s2d";
import { SourceIcon } from "@/components/shared/source-icon";
import { PathwayBadge } from "@/components/shared/pathway-badge";
import { PriorityDot } from "@/components/shared/priority-dot";
import { CompanyBadge } from "@/components/shared/company-badge";
import { S2DCopilot } from "@/components/s2d/s2d-copilot";
import { ItemContextPanel } from "@/components/s2d/item-context-panel";
import type { S2DItem } from "@/types";
import { PRIORITY_META } from "@/types";
import { cn } from "@/lib/utils";

type Banner = { kind: "ok" | "err"; msg: string } | null;

export function S2DItemSheet() {
  const selectedId = useS2DStore((s) => s.selectedItemId);
  const setSelected = useS2DStore((s) => s.setSelectedItem);
  const { data: items } = useS2DItems();
  const item = selectedId ? items?.find((i) => i.id === selectedId) ?? null : null;
  const open = selectedId != null && item != null;

  return (
    <Sheet open={open} onOpenChange={(v) => !v && setSelected(null)}>
      <SheetContent side="right" className="flex flex-col gap-0 p-0">
        {item && <ItemSheetBody item={item} key={item.id} />}
      </SheetContent>
    </Sheet>
  );
}

function ItemSheetBody({ item }: { item: S2DItem }) {
  const priorityMeta = PRIORITY_META[item.priority];
  const setSelected = useS2DStore((s) => s.setSelectedItem);
  const updateItem = useUpdateS2DItem();
  const [banner, setBanner] = useState<Banner>(null);

  useEffect(() => {
    if (banner?.kind === "ok") {
      const t = setTimeout(() => setBanner(null), 3000);
      return () => clearTimeout(t);
    }
  }, [banner]);

  // Auto-mark-read on open, with a 2s pause so the user actually sees the
  // pulsing dot + callout before they clear. The key={item.id} on
  // ItemSheetBody ensures this remounts (and re-runs the timer) per item.
  useEffect(() => {
    if (!item.has_unseen_updates) return;
    const t = setTimeout(() => {
      updateItem.mutate({
        id: item.id,
        patch: { has_unseen_updates: false },
      });
    }, 2000);
    return () => clearTimeout(t);
    // updateItem ref is stable across renders within the same mutation
    // instance; we don't want the timer reset by parent re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  function clearUnseen() {
    updateItem.mutate({ id: item.id, patch: { has_unseen_updates: false } });
  }

  return (
    <>
      <SheetHeader className="space-y-3 border-b border-border/40 p-5 pb-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            {item.source_type && <SourceIcon type={item.source_type} withLabel />}
            <span className="font-mono text-[10px] text-muted-foreground">·</span>
            <span className="text-[11px] text-muted-foreground truncate">{item.source_label}</span>
          </div>
          {(item.linked_sources?.length ?? 0) > 0 && (
            <div className="flex flex-col gap-0.5">
              {item.linked_sources!.map((s, i) => (
                <div key={i} className="flex items-center gap-2">
                  {s.source_type && (
                    <SourceIcon
                      type={s.source_type as Parameters<typeof SourceIcon>[0]["type"]}
                      withLabel
                    />
                  )}
                  <span className="font-mono text-[10px] text-muted-foreground">·</span>
                  <span className="text-[11px] text-muted-foreground truncate">
                    {s.source_label ?? s.source_thread_id ?? "(unknown)"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        {item.ticket_number != null && (
          <div className="flex items-center gap-2 pr-8">
            <button
              type="button"
              onClick={() => navigator.clipboard?.writeText(`MASH-${item.ticket_number}`)}
              className="rounded border border-border/50 bg-secondary/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground hover:bg-secondary hover:text-foreground"
              title="Copy ticket ID"
            >
              MASH-{item.ticket_number}
            </button>
          </div>
        )}
        <SheetTitle className="text-base leading-snug pr-8">{item.title}</SheetTitle>
        <div className="flex flex-wrap items-center gap-2">
          <PathwayBadge pathway={item.pathway} compact={false} />
          <div className="flex items-center gap-1.5 rounded border border-border/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            <PriorityDot priority={item.priority} />
            <span>{priorityMeta.label}</span>
          </div>
          {item.est_minutes != null && (
            <span className="rounded border border-border/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {item.est_minutes}m
            </span>
          )}
          <div className="ml-auto">
            <CompanyBadge company={item.company} />
          </div>
        </div>
        {item.description && (
          <SheetDescription className="text-[13px] leading-relaxed text-foreground/80">
            {item.description}
          </SheetDescription>
        )}
      </SheetHeader>

      <ScrollArea className="flex-1">
        <div className="space-y-4 p-5">
          {banner && <BannerCallout banner={banner} onClose={() => setBanner(null)} />}

          {item.has_unseen_updates && (
            <UnseenUpdateCallout
              summary={item.last_update_summary}
              onMarkRead={clearUnseen}
            />
          )}

          <S2DCopilot item={item} />

          <ItemContextPanel item={item} />

          <PathwayActions item={item} setBanner={setBanner} onClose={() => setSelected(null)} />

          <Separator />

          <MiniActions item={item} setBanner={setBanner} />

          <div className="rounded-md border border-border/40 bg-secondary/20 p-3 text-[11px] text-muted-foreground space-y-1 font-mono">
            <div className="flex justify-between">
              <span>id</span>
              <span className="truncate text-right">{item.id}</span>
            </div>
            <div className="flex justify-between">
              <span>created</span>
              <span>{new Date(item.created_at).toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span>updated</span>
              <span>{new Date(item.updated_at).toLocaleString()}</span>
            </div>
            {item.queue_reason && (
              <div className="flex justify-between gap-2">
                <span>queue</span>
                <span className="truncate text-right">{item.queue_reason}</span>
              </div>
            )}
            {item.outcome && (
              <div className="flex justify-between gap-2">
                <span>outcome</span>
                <span className="truncate text-right">{item.outcome}</span>
              </div>
            )}
          </div>
        </div>
      </ScrollArea>
    </>
  );
}

function UnseenUpdateCallout({
  summary,
  onMarkRead,
}: {
  summary?: string | null;
  onMarkRead: () => void;
}) {
  return (
    <div className="flex items-start gap-2 rounded border border-primary/30 bg-primary/10 p-2.5 text-[12px]">
      <Bell className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
      <div className="flex-1">
        <span className="font-medium">Updated: </span>
        <span className="text-foreground/90">
          {summary ?? "Mashi added new information to this item."}
        </span>
      </div>
      <button
        onClick={onMarkRead}
        className="shrink-0 rounded border border-border/50 bg-card/60 px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        Mark read
      </button>
    </div>
  );
}

function BannerCallout({ banner, onClose }: { banner: NonNullable<Banner>; onClose: () => void }) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded border p-2.5 text-[12px]",
        banner.kind === "ok"
          ? "border-primary/30 bg-primary/10 text-foreground"
          : "border-destructive/30 bg-destructive/10 text-destructive"
      )}
    >
      {banner.kind === "ok" ? (
        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
      ) : (
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      )}
      <span className="flex-1">{banner.msg}</span>
      <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function PathwayActions({
  item,
  setBanner,
  onClose,
}: {
  item: S2DItem;
  setBanner: (b: Banner) => void;
  onClose: () => void;
}) {
  if (item.pathway === "quick_reply" || item.pathway === "drafted_response") {
    return <DraftReplyAction item={item} setBanner={setBanner} onClose={onClose} />;
  }
  if (item.pathway === "decision_gate") {
    return <DecisionAction item={item} setBanner={setBanner} onClose={onClose} />;
  }
  if (item.pathway === "delegated") {
    return <DelegateAction item={item} setBanner={setBanner} />;
  }
  if (item.pathway === "watching") {
    return <FollowUpAction item={item} setBanner={setBanner} />;
  }
  if (item.pathway === "heads_down") {
    return <HeadsDownAction item={item} setBanner={setBanner} />;
  }
  if (item.pathway === "meeting_backed") {
    return <MeetingBackedAction item={item} setBanner={setBanner} />;
  }
  return null;
}

function DraftReplyAction({
  item,
  setBanner,
  onClose,
}: {
  item: S2DItem;
  setBanner: (b: Banner) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(pickInitialDraft(item));
  const [sending, setSending] = useState(false);
  const sourceLabel =
    item.source_type === "slack" ? "Slack" : item.source_type === "gmail" ? "Gmail" : item.source_type ?? "";

  async function sendNow() {
    if (!draft.trim()) return;
    setSending(true);
    try {
      const res = await fetch(`/api/s2d/${item.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: draft }),
      });
      const data = await res.json();
      if (!res.ok) {
        setBanner({ kind: "err", msg: data.error ?? `Send failed (${res.status})` });
        return;
      }
      setBanner({ kind: "ok", msg: data.message ?? "Sent" });
      setTimeout(onClose, 800);
    } catch (err) {
      setBanner({ kind: "err", msg: err instanceof Error ? err.message : "Send failed" });
    } finally {
      setSending(false);
    }
  }

  async function copyDraft() {
    try {
      await navigator.clipboard.writeText(draft);
      setBanner({ kind: "ok", msg: "Copied to clipboard" });
    } catch {
      setBanner({ kind: "err", msg: "Couldn't copy" });
    }
  }

  const supportsSend = item.source_type === "gmail" || item.source_type === "slack";

  return (
    <div className="space-y-2">
      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={6}
        placeholder="Draft your reply…"
        className="text-[13px] leading-relaxed"
      />
      <div className="flex flex-wrap items-center gap-2">
        {supportsSend && (
          <Button size="sm" onClick={sendNow} disabled={sending || !draft.trim()} className="gap-1.5">
            {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            {sending ? "Sending…" : `Send via ${sourceLabel}`}
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={copyDraft} className="gap-1.5">
          <Copy className="h-3.5 w-3.5" />
          Copy
        </Button>
        {item.source_url && (
          <a
            href={item.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <ExternalLink className="h-3 w-3" />
            Open source
          </a>
        )}
      </div>
    </div>
  );
}

function pickInitialDraft(item: S2DItem): string {
  if (item.ai_draft) return item.ai_draft;
  const suggestion = item.ai_suggestion ?? "";
  const m = suggestion.match(/DRAFT:\s*([\s\S]*?)(?:\n\s*VERIFY:|$)/i);
  if (m) return m[1].trim();
  return "";
}

function DecisionAction({
  item,
  setBanner,
  onClose,
}: {
  item: S2DItem;
  setBanner: (b: Banner) => void;
  onClose: () => void;
}) {
  const updateItem = useUpdateS2DItem();
  const [decision, setDecision] = useState("");
  const [saving, setSaving] = useState(false);

  async function record() {
    if (!decision.trim()) return;
    setSaving(true);
    try {
      await updateItem.mutateAsync({
        id: item.id,
        patch: { status: "done", outcome: decision, resolved_via: "manual" },
      });
      setBanner({ kind: "ok", msg: "Decision recorded" });
      setTimeout(onClose, 800);
    } catch (err) {
      setBanner({ kind: "err", msg: err instanceof Error ? err.message : "Couldn't save" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <Textarea
        value={decision}
        onChange={(e) => setDecision(e.target.value)}
        rows={3}
        placeholder="Record your decision…"
        className="text-[13px] leading-relaxed"
      />
      <Button size="sm" onClick={record} disabled={saving || !decision.trim()} className="gap-1.5">
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
        Record decision
      </Button>
    </div>
  );
}

function DelegateAction({ item, setBanner }: { item: S2DItem; setBanner: (b: Banner) => void }) {
  const updateItem = useUpdateS2DItem();
  const [name, setName] = useState(item.delegated_to ?? "");
  const [saving, setSaving] = useState(false);

  async function commit() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await updateItem.mutateAsync({
        id: item.id,
        patch: {
          pathway: "delegated",
          status: "in_queue",
          delegated_to: name.trim(),
          queue_reason: `Delegated to ${name.trim()}`,
        },
      });
      setBanner({ kind: "ok", msg: `Delegated to ${name.trim()}` });
    } catch (err) {
      setBanner({ kind: "err", msg: err instanceof Error ? err.message : "Couldn't save" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Who's doing it? (name)"
      />
      <Button size="sm" onClick={commit} disabled={saving || !name.trim()} className="gap-1.5">
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
        Track as delegated
      </Button>
    </div>
  );
}

function FollowUpAction({ item, setBanner }: { item: S2DItem; setBanner: (b: Banner) => void }) {
  const updateItem = useUpdateS2DItem();
  const [when, setWhen] = useState("");

  async function setReminder(date: string, label: string) {
    try {
      await updateItem.mutateAsync({
        id: item.id,
        patch: { status: "in_queue", queue_until: date, queue_reason: `Follow up ${label}` },
      });
      setBanner({ kind: "ok", msg: `Reminder set: ${label}` });
    } catch (err) {
      setBanner({ kind: "err", msg: err instanceof Error ? err.message : "Couldn't save" });
    }
  }

  return (
    <div className="space-y-2">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Follow up in…</div>
      <div className="flex flex-wrap gap-1.5">
        {QUICK_REMINDERS.map((q) => (
          <Button key={q.label} size="sm" variant="outline" onClick={() => setReminder(q.iso(), q.label)}>
            {q.label}
          </Button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Input
          type="date"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
          className="h-8 w-44 text-[12px]"
        />
        <Button
          size="sm"
          variant="outline"
          disabled={!when}
          onClick={() => setReminder(new Date(`${when}T09:00:00`).toISOString(), `on ${when}`)}
        >
          Set
        </Button>
      </div>
    </div>
  );
}

const QUICK_REMINDERS = [
  { label: "tomorrow", iso: () => isoIn({ days: 1 }) },
  { label: "in 3 days", iso: () => isoIn({ days: 3 }) },
  { label: "next week", iso: () => isoIn({ days: 7 }) },
  { label: "in 2 weeks", iso: () => isoIn({ days: 14 }) },
];

function isoIn({ days = 0, hours = 0 }: { days?: number; hours?: number }) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(d.getHours() + hours);
  return d.toISOString();
}

function HeadsDownAction({ item, setBanner }: { item: S2DItem; setBanner: (b: Banner) => void }) {
  const updateItem = useUpdateS2DItem();
  function startNow() {
    updateItem.mutate({ id: item.id, patch: { status: "in_progress" } });
    setBanner({ kind: "ok", msg: "Started, moved to In Progress" });
  }
  const gcalUrl = buildGcalCreateUrl(item);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" onClick={startNow} className="gap-1.5">
        <Zap className="h-3.5 w-3.5" />
        Start now
      </Button>
      <a
        href={gcalUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12px] hover:bg-accent"
      >
        <CalendarPlus className="h-3.5 w-3.5" />
        Block time in Calendar
      </a>
    </div>
  );
}

function buildGcalCreateUrl(item: S2DItem): string {
  const title = encodeURIComponent(item.title);
  const details = encodeURIComponent(item.description ?? "");
  const start = new Date();
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  const end = new Date(start.getTime() + (item.est_minutes ?? 60) * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&details=${details}&dates=${fmt(start)}/${fmt(end)}`;
}

function MeetingBackedAction({ item, setBanner }: { item: S2DItem; setBanner: (b: Banner) => void }) {
  const updateItem = useUpdateS2DItem();
  function markQueued() {
    updateItem.mutate({
      id: item.id,
      patch: {
        status: "in_queue",
        queue_reason: item.queue_reason ?? "Will discuss in upcoming meeting",
      },
    });
    setBanner({ kind: "ok", msg: "Marked as queued for meeting" });
  }
  return (
    <div className="space-y-2">
      <p className="text-[12px] text-muted-foreground">
        This will be addressed in a meeting. Mark it queued, or open Calendar to confirm which one.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={markQueued} className="gap-1.5">
          <Clock className="h-3.5 w-3.5" />
          Mark as queued
        </Button>
        <a
          href="https://calendar.google.com"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12px] hover:bg-accent"
        >
          <ExternalLink className="h-3 w-3" />
          Open Calendar
        </a>
      </div>
    </div>
  );
}

function MiniActions({ item, setBanner }: { item: S2DItem; setBanner: (b: Banner) => void }) {
  const updateItem = useUpdateS2DItem();

  async function addToSprint() {
    const today = new Date().toISOString().slice(0, 10);
    try {
      await updateItem.mutateAsync({
        id: item.id,
        patch: { sprint_date: today, sprint_type: "morning", status: "todo" },
      });
      setBanner({ kind: "ok", msg: "Added to today's sprint" });
    } catch (err) {
      setBanner({ kind: "err", msg: err instanceof Error ? err.message : "Couldn't save" });
    }
  }

  async function drop() {
    if (!confirm("Drop this item? It'll be marked done with outcome 'Dropped'.")) return;
    try {
      await updateItem.mutateAsync({
        id: item.id,
        patch: { status: "done", outcome: "Dropped", resolved_via: "manual" },
      });
      setBanner({ kind: "ok", msg: "Dropped" });
    } catch (err) {
      setBanner({ kind: "err", msg: err instanceof Error ? err.message : "Couldn't save" });
    }
  }

  async function markDone() {
    const outcome = window.prompt("Optional: outcome / what happened?") ?? "";
    try {
      await updateItem.mutateAsync({
        id: item.id,
        patch: { status: "done", outcome: outcome || "Done", resolved_via: "manual" },
      });
      setBanner({ kind: "ok", msg: "Marked done" });
    } catch (err) {
      setBanner({ kind: "err", msg: err instanceof Error ? err.message : "Couldn't save" });
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" onClick={markDone} className="gap-1.5">
        <Check className="h-3.5 w-3.5" />
        Mark done
      </Button>
      <Button variant="outline" size="sm" onClick={addToSprint} className="gap-1.5">
        <Zap className="h-3.5 w-3.5" />
        Add to sprint
      </Button>
      <SnoozePopover item={item} setBanner={setBanner} />
      <Button variant="ghost" size="sm" onClick={drop} className="gap-1.5 text-destructive">
        <Trash2 className="h-3.5 w-3.5" />
        Drop
      </Button>
    </div>
  );
}

function SnoozePopover({ item, setBanner }: { item: S2DItem; setBanner: (b: Banner) => void }) {
  const updateItem = useUpdateS2DItem();
  const [open, setOpen] = useState(false);

  async function snooze(date: string, label: string) {
    try {
      await updateItem.mutateAsync({
        id: item.id,
        patch: {
          status: "in_queue",
          snoozed_until: date,
          queue_reason: `Snoozed until ${label}`,
        },
      });
      setBanner({ kind: "ok", msg: `Snoozed until ${label}` });
      setOpen(false);
    } catch (err) {
      setBanner({ kind: "err", msg: err instanceof Error ? err.message : "Couldn't save" });
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <BellOff className="h-3.5 w-3.5" />
          Snooze
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 space-y-1">
        <div className="px-1 text-[11px] uppercase tracking-wider text-muted-foreground">
          Snooze until…
        </div>
        {SNOOZE_OPTIONS.map((s) => (
          <button
            key={s.label}
            onClick={() => snooze(s.iso(), s.label)}
            className="block w-full rounded px-2 py-1.5 text-left text-[12px] hover:bg-accent"
          >
            {s.label}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

const SNOOZE_OPTIONS = [
  { label: "later today", iso: () => isoIn({ hours: 3 }) },
  { label: "tomorrow morning", iso: () => isoTomorrowMorning() },
  { label: "in 3 days", iso: () => isoIn({ days: 3 }) },
  { label: "next week", iso: () => isoIn({ days: 7 }) },
];

function isoTomorrowMorning() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d.toISOString();
}
