"use client";

// translucency-audit-ok: file — legacy callsites, migrate to sanctioned scale (/15, /40, /55, /60, /80, /95) case-by-case during component touch-ups.

import { useMemo, useState } from "react";
import { Mail, MessageSquare, AlertCircle, Inbox, ExternalLink } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChromeBar, EmptyState } from "@/components/layout/primitives";
import { cn } from "@/lib/utils";
import { useInboxMessages, type InboxMessage } from "@/hooks/use-inbox";
import { useCompanies } from "@/hooks/use-s2d";

type PriorityFilter = "all" | "urgent" | "action_required" | "fyi" | "low_priority" | "noise";
type SourceFilter = "all" | "gmail" | "slack";

const PRIORITY_COLORS: Record<NonNullable<InboxMessage["priority_label"]>, string> = {
  urgent: "bg-destructive/20 text-destructive border-destructive/40",
  action_required: "bg-amber-500/20 text-amber-400 border-amber-500/40",
  fyi: "bg-secondary text-muted-foreground border-border/40",
  low_priority: "bg-secondary text-muted-foreground/70 border-border/40",
  noise: "bg-secondary text-muted-foreground/50 border-border/40",
};

const PRIORITY_LABEL_SHORT: Record<NonNullable<InboxMessage["priority_label"]>, string> = {
  urgent: "urgent",
  action_required: "action",
  fyi: "fyi",
  low_priority: "low",
  noise: "noise",
};

export function InboxView() {
  const { data: messages = [], isLoading } = useInboxMessages();
  const { data: companies = [] } = useCompanies();
  const companyMap = new Map(companies.map((c) => [c.id, c]));

  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [companyFilter, setCompanyFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let r = messages;
    if (priorityFilter !== "all") r = r.filter((m) => m.priority_label === priorityFilter);
    if (sourceFilter !== "all") r = r.filter((m) => m.source === sourceFilter);
    if (companyFilter !== "all") {
      r = companyFilter === "none"
        ? r.filter((m) => !m.company_id)
        : r.filter((m) => m.company_id === companyFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      r = r.filter(
        (m) =>
          (m.subject ?? "").toLowerCase().includes(q) ||
          (m.preview ?? "").toLowerCase().includes(q) ||
          (m.sender_name ?? "").toLowerCase().includes(q) ||
          (m.sender_email ?? "").toLowerCase().includes(q)
      );
    }
    return r;
  }, [messages, priorityFilter, sourceFilter, companyFilter, search]);

  const selected = filtered.find((m) => m.id === selectedId) ?? null;

  // Counts for filter pills
  const counts = useMemo(() => {
    const out: Record<string, number> = {
      all: messages.length,
      urgent: 0,
      action_required: 0,
      fyi: 0,
      low_priority: 0,
      noise: 0,
    };
    for (const m of messages) {
      if (m.priority_label) out[m.priority_label] = (out[m.priority_label] ?? 0) + 1;
    }
    return out;
  }, [messages]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      {/* Filter bar */}
      <ChromeBar className="px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <FilterPill
            active={priorityFilter === "all"}
            onClick={() => setPriorityFilter("all")}
            label="All"
            count={counts.all}
          />
          <FilterPill
            active={priorityFilter === "urgent"}
            onClick={() => setPriorityFilter("urgent")}
            label="Urgent"
            count={counts.urgent}
            tone="destructive"
          />
          <FilterPill
            active={priorityFilter === "action_required"}
            onClick={() => setPriorityFilter("action_required")}
            label="Action"
            count={counts.action_required}
            tone="primary"
          />
          <FilterPill
            active={priorityFilter === "fyi"}
            onClick={() => setPriorityFilter("fyi")}
            label="FYI"
            count={counts.fyi}
          />
          <FilterPill
            active={priorityFilter === "low_priority"}
            onClick={() => setPriorityFilter("low_priority")}
            label="Low"
            count={counts.low_priority}
          />
          <FilterPill
            active={priorityFilter === "noise"}
            onClick={() => setPriorityFilter("noise")}
            label="Noise"
            count={counts.noise}
          />

          <div className="mx-2 h-4 w-px bg-border/40" />

          <Select
            value={sourceFilter}
            onValueChange={(v) => setSourceFilter(v as SourceFilter)}
          >
            <SelectTrigger className="h-7 rounded border-border/40 bg-background px-2 text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              <SelectItem value="gmail">Gmail</SelectItem>
              <SelectItem value="slack">Slack</SelectItem>
            </SelectContent>
          </Select>

          <Select value={companyFilter} onValueChange={setCompanyFilter}>
            <SelectTrigger className="h-7 rounded border-border/40 bg-background px-2 text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All companies</SelectItem>
              <SelectItem value="none">No company</SelectItem>
              {companies.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search subject, sender…"
            className="ml-auto h-7 w-56 text-[12px]"
          />
        </div>
      </ChromeBar>

      {/* Split view: list + detail */}
      <div className="flex min-h-0 flex-1">
        <ScrollArea className="w-[440px] shrink-0 border-r border-border/40">
          {isLoading ? (
            <div className="space-y-2 p-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-16" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex h-full items-center justify-center p-6">
              <EmptyState
                title="No messages match"
                subtitle="Try clearing a filter or broadening your search."
              />
            </div>
          ) : (
            <ul className="divide-y divide-border/40">
              {filtered.map((m) => (
                <li key={m.id}>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setSelectedId(m.id)}
                    className={cn(
                      "block h-auto w-full justify-start whitespace-normal rounded-none px-3 py-2.5 text-left font-normal transition-colors hover:bg-accent/30",
                      selectedId === m.id && "bg-accent/50"
                    )}
                  >
                    <MessageRow message={m} company={m.company_id ? companyMap.get(m.company_id) : undefined} />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>

        <div className="min-w-0 flex-1">
          {selected ? (
            <MessageDetail message={selected} />
          ) : (
            <div className="flex h-full items-center justify-center p-8">
              <EmptyState
                icon={<Mail className="h-5 w-5" />}
                title="Pick a message"
                subtitle="Select a message on the left to read its preview and triage notes."
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FilterPill({
  active,
  onClick,
  label,
  count,
  tone = "default",
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  tone?: "default" | "primary" | "destructive";
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onClick}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded border px-2 text-[11px] font-normal transition-colors",
        active
          ? tone === "destructive"
            ? "border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/15 hover:text-destructive"
            : tone === "primary"
            ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary"
            : "border-border bg-accent text-foreground"
          : "border-border/40 text-muted-foreground hover:bg-accent/30"
      )}
    >
      <span>{label}</span>
      <span className="font-mono text-[10px] opacity-70">{count}</span>
    </Button>
  );
}

function MessageRow({
  message,
  company,
}: {
  message: InboxMessage;
  company?: { name: string; color_hex: string };
}) {
  const Icon = message.source === "gmail" ? Mail : MessageSquare;
  const senderLabel = message.sender_name ?? message.sender_email ?? "(unknown)";
  return (
    <div>
      <div className="flex items-center gap-2">
        <Icon
          className={cn(
            "h-3 w-3 shrink-0",
            message.source === "gmail" ? "text-rose-400" : "text-violet-400"
          )}
        />
        <span className="truncate text-[12px] font-medium">{senderLabel}</span>
        {message.priority_label && (
          <span
            className={cn(
              "shrink-0 rounded border px-1.5 py-0.5 text-[9px] uppercase tracking-wide",
              PRIORITY_COLORS[message.priority_label]
            )}
          >
            {PRIORITY_LABEL_SHORT[message.priority_label]}
          </span>
        )}
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
          {formatTime(message.received_at)}
        </span>
      </div>
      <div className="mt-0.5 truncate text-[12px] text-foreground/80">
        {message.subject ?? message.channel ?? "(no subject)"}
      </div>
      <div className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">
        {message.preview ?? ""}
      </div>
      {company && (
        <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: company.color_hex }} />
          {company.name}
        </div>
      )}
    </div>
  );
}

function MessageDetail({ message }: { message: InboxMessage }) {
  const Icon = message.source === "gmail" ? Mail : MessageSquare;
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border/40 p-5">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Icon className={cn("h-3.5 w-3.5", message.source === "gmail" ? "text-rose-400" : "text-violet-400")} />
          <span>{message.source}</span>
          {message.priority_label && (
            <span
              className={cn(
                "rounded border px-1.5 py-0.5 text-[9px] uppercase tracking-wide",
                PRIORITY_COLORS[message.priority_label]
              )}
            >
              {PRIORITY_LABEL_SHORT[message.priority_label]}
            </span>
          )}
          <span className="ml-auto font-mono text-[10px]">{formatTime(message.received_at)}</span>
        </div>
        <h2 className="mt-2 text-base font-semibold tracking-tight">
          {message.subject ?? message.channel ?? "(no subject)"}
        </h2>
        <div className="mt-1 text-[12px] text-muted-foreground">
          From {message.sender_name ?? "—"}{" "}
          {message.sender_email && <span className="font-mono">&lt;{message.sender_email}&gt;</span>}
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-4 p-5">
          {message.preview && (
            <div className="rounded-md border border-border/40 bg-card p-4 text-[13px] leading-relaxed whitespace-pre-wrap text-foreground/90">
              {message.preview}
              <div className="mt-3 text-[11px] text-muted-foreground">
                (Showing preview only — full body not stored to keep DB lean. Open the source for the full message.)
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {message.s2d_item_id ? (
              <a
                href={`/s2d?item=${message.s2d_item_id}`}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12px] hover:bg-accent"
              >
                <AlertCircle className="h-3.5 w-3.5 text-primary" />
                Open S2D item
              </a>
            ) : (
              <Button size="sm" variant="outline" disabled className="gap-1.5" title="Auto-promoted by triage if urgent/action_required">
                <Inbox className="h-3.5 w-3.5" />
                Not in S2D
              </Button>
            )}

            <a
              href={
                message.source === "gmail"
                  ? `https://mail.google.com/mail/u/0/#inbox/${message.thread_id ?? ""}`
                  : `https://slack.com/app_redirect?channel=${(message.external_id || "").split(":")[1] ?? ""}`
              }
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12px] hover:bg-accent"
            >
              <ExternalLink className="h-3 w-3" />
              Open in {message.source === "gmail" ? "Gmail" : "Slack"}
            </a>
          </div>

          <div className="rounded-md border border-border/40 bg-secondary/20 p-3 text-[11px] font-mono text-muted-foreground space-y-1">
            <div className="flex justify-between gap-2">
              <span>external_id</span>
              <span className="truncate text-right">{message.external_id}</span>
            </div>
            {message.thread_id && (
              <div className="flex justify-between gap-2">
                <span>thread_id</span>
                <span className="truncate text-right">{message.thread_id}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span>priority_score</span>
              <span>{message.priority_score ?? "—"}</span>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

function formatTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const diffMin = Math.round((Date.now() - d.getTime()) / 60000);
  if (diffMin < 1) return "now";
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
