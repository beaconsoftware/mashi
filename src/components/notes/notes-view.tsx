"use client";

import { useMemo, useState } from "react";
import { Mic, Users, Calendar as CalendarIcon, ListChecks } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useMeetings, useActionItemsForMeeting } from "@/hooks/use-meetings";
import { useCompanies } from "@/hooks/use-s2d";

export function NotesView() {
  const { data: meetings = [], isLoading } = useMeetings();
  const { data: companies = [] } = useCompanies();
  const companyMap = new Map(companies.map((c) => [c.id, c]));

  const [search, setSearch] = useState("");
  const [companyFilter, setCompanyFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let r = meetings;
    if (companyFilter !== "all") {
      r = companyFilter === "none"
        ? r.filter((m) => !m.company_id)
        : r.filter((m) => m.company_id === companyFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      r = r.filter(
        (m) =>
          (m.title ?? "").toLowerCase().includes(q) ||
          (m.summary ?? "").toLowerCase().includes(q) ||
          (m.attendees ?? []).some((a) => (a.name ?? a.email ?? "").toLowerCase().includes(q))
      );
    }
    return r;
  }, [meetings, companyFilter, search]);

  const selected = filtered.find((m) => m.id === selectedId) ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border/40 bg-secondary/10 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
            {meetings.length} meetings
          </span>
          <select
            value={companyFilter}
            onChange={(e) => setCompanyFilter(e.target.value)}
            className="h-7 rounded border border-border/40 bg-background px-2 text-[11px]"
          >
            <option value="all">All companies</option>
            <option value="none">No company</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title, summary, attendees…"
            className="ml-auto h-7 w-64 text-[12px]"
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <ScrollArea className="w-[420px] shrink-0 border-r border-border/40">
          {isLoading ? (
            <div className="space-y-2 p-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-16" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex h-64 items-center justify-center text-center text-sm text-muted-foreground">
              No meetings match.
            </div>
          ) : (
            <ul className="divide-y divide-border/40">
              {filtered.map((m) => {
                const company = m.company_id ? companyMap.get(m.company_id) : undefined;
                return (
                  <li key={m.id}>
                    <button
                      onClick={() => setSelectedId(m.id)}
                      className={cn(
                        "block w-full px-3 py-2.5 text-left transition-colors hover:bg-accent/30",
                        selectedId === m.id && "bg-accent/50"
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <Mic className="h-3 w-3 shrink-0 text-orange-400" />
                        <span className="truncate text-[12px] font-medium">
                          {m.title ?? "(untitled meeting)"}
                        </span>
                        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                          {fmtDate(m.date)}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                        <Users className="h-3 w-3" />
                        <span className="truncate">
                          {(m.attendees ?? [])
                            .map((a) => a.name ?? a.email ?? "?")
                            .slice(0, 4)
                            .join(", ")}
                          {(m.attendees ?? []).length > 4 ? ` +${(m.attendees ?? []).length - 4}` : ""}
                        </span>
                      </div>
                      {company && (
                        <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                          <span
                            className="h-1.5 w-1.5 rounded-full"
                            style={{ backgroundColor: company.color_hex }}
                          />
                          {company.name}
                        </div>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>

        <div className="min-w-0 flex-1">
          {selected ? (
            <MeetingDetail meeting={selected} />
          ) : (
            <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
              Pick a meeting to see its summary and action items.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MeetingDetail({ meeting }: { meeting: ReturnType<typeof useMeetings>["data"] extends Array<infer T> | undefined ? T : never }) {
  const { data: actionItems = [] } = useActionItemsForMeeting(meeting.id);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border/40 p-5">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Mic className="h-3.5 w-3.5 text-orange-400" />
          <span>Fireflies</span>
          <span className="font-mono">·</span>
          <CalendarIcon className="h-3 w-3" />
          <span>{fmtDateFull(meeting.date)}</span>
          {meeting.duration_minutes != null && (
            <>
              <span className="font-mono">·</span>
              <span>{meeting.duration_minutes} min</span>
            </>
          )}
        </div>
        <h2 className="mt-2 text-base font-semibold tracking-tight">
          {meeting.title ?? "(untitled meeting)"}
        </h2>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(meeting.attendees ?? []).map((a, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 rounded border border-border/40 bg-secondary/40 px-1.5 py-0.5 text-[10px]"
            >
              <Users className="h-2.5 w-2.5" />
              {a.name ?? a.email ?? "?"}
            </span>
          ))}
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-5 p-5">
          {meeting.summary && (
            <section>
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Summary
              </h3>
              <div className="rounded-md border border-border/40 bg-card p-3 text-[13px] leading-relaxed text-foreground/90 whitespace-pre-wrap">
                {meeting.summary}
              </div>
            </section>
          )}

          <section>
            <h3 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <ListChecks className="h-3 w-3" />
              Action items ({actionItems.length})
            </h3>
            {actionItems.length === 0 ? (
              <div className="rounded-md border border-dashed border-border/40 p-3 text-[12px] text-muted-foreground/70">
                No action items extracted from this meeting.
              </div>
            ) : (
              <ul className="rounded-md border border-border/40 bg-card divide-y divide-border/40">
                {actionItems.map((ai) => (
                  <li key={ai.id} className="flex items-start gap-3 px-3 py-2 text-[12px]">
                    <span className="shrink-0 rounded border border-border/40 bg-secondary/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                      {ai.assignee ?? "—"}
                    </span>
                    <span className="flex-1 text-foreground/90">{ai.description}</span>
                    {ai.status === "converted_to_s2d" && (
                      <span className="shrink-0 text-[10px] text-primary">in S2D</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </ScrollArea>
    </div>
  );
}

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const diffDay = Math.round((Date.now() - d.getTime()) / 86_400_000);
  if (diffDay < 1) return "today";
  if (diffDay === 1) return "yesterday";
  if (diffDay < 7) return `${diffDay}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function fmtDateFull(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
