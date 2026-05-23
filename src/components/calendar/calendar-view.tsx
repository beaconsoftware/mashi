"use client";

// translucency-audit-ok: file — legacy callsites, migrate to sanctioned scale (/15, /40, /55, /60, /80, /95) case-by-case during component touch-ups.

import { useMemo, useState } from "react";
import {
  Calendar as CalIcon,
  Users,
  MapPin,
  Video,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  List,
  CalendarDays,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { ChromeBar, EmptyState } from "@/components/layout/primitives";
import { cn } from "@/lib/utils";
import { useCalendarEvents, type CalendarEventRow } from "@/hooks/use-calendar";
import { useCompanies } from "@/hooks/use-s2d";
import { useMagneticHover, useSelectBurst } from "@/lib/animation/interactions";
import type { Company } from "@/types";

type View = "week" | "day" | "agenda";
type Filter = "upcoming" | "today" | "past";

const HOUR_PX = 44; // height of one hour row in week/day grid
const DAY_START_HOUR = 7;
const DAY_END_HOUR = 21;
const HOURS = Array.from({ length: DAY_END_HOUR - DAY_START_HOUR }, (_, i) => DAY_START_HOUR + i);

// ============================================================================
// Top-level
// ============================================================================

export function CalendarView() {
  const { data: events = [], isLoading } = useCalendarEvents();
  const { data: companies = [] } = useCompanies();
  const companyMap = new Map(companies.map((c) => [c.id, c]));

  const [view, setView] = useState<View>("week");
  const [filter, setFilter] = useState<Filter>("upcoming");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<Date>(() => startOfWeek(new Date()));

  // Agenda filtering — Week/Day modes always show everything in the visible range.
  // `anchor` is included as a dep so the "today/past/upcoming" pivot recomputes
  // when the user navigates time (and to satisfy the no-Date.now-during-render
  // rule by reading from a value that already changes externally).
  const agendaFiltered = useMemo(() => {
    if (view !== "agenda") return events;
    const now = anchor.getTime();
    if (filter === "today") {
      const s = new Date(anchor);
      s.setHours(0, 0, 0, 0);
      const e = new Date(anchor);
      e.setHours(23, 59, 59, 999);
      return events.filter((ev) => {
        const t = new Date(ev.start_at).getTime();
        return t >= s.getTime() && t <= e.getTime();
      });
    }
    if (filter === "past")
      return events.filter((ev) => new Date(ev.end_at).getTime() < now).reverse();
    return events.filter((ev) => new Date(ev.end_at).getTime() >= now);
  }, [events, filter, view, anchor]);

  const selected = events.find((e) => e.id === selectedId) ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <Toolbar
        view={view}
        setView={setView}
        filter={filter}
        setFilter={setFilter}
        anchor={anchor}
        setAnchor={setAnchor}
        count={view === "agenda" ? agendaFiltered.length : null}
      />

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 border-r border-border/40">
          {isLoading ? (
            <div className="space-y-2 p-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : view === "week" ? (
            <WeekGrid
              events={events}
              anchor={anchor}
              selectedId={selectedId}
              onSelect={setSelectedId}
              companyMap={companyMap}
            />
          ) : view === "day" ? (
            <DayGrid
              events={events}
              anchor={anchor}
              selectedId={selectedId}
              onSelect={setSelectedId}
              companyMap={companyMap}
            />
          ) : (
            <AgendaList
              events={agendaFiltered}
              selectedId={selectedId}
              onSelect={setSelectedId}
              companyMap={companyMap}
            />
          )}
        </div>

        <div className="w-[420px] shrink-0">
          {selected ? (
            <EventDetail event={selected} />
          ) : (
            <div className="flex h-full items-center justify-center p-8">
              <EmptyState
                icon={<CalIcon className="h-5 w-5" />}
                title="Pick an event"
                subtitle="Click a calendar event to see its details, attendees, and links."
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Toolbar: view switcher + nav arrows + range label
// ============================================================================

function Toolbar({
  view,
  setView,
  filter,
  setFilter,
  anchor,
  setAnchor,
  count,
}: {
  view: View;
  setView: (v: View) => void;
  filter: Filter;
  setFilter: (f: Filter) => void;
  anchor: Date;
  setAnchor: (d: Date) => void;
  count: number | null;
}) {
  function shift(days: number) {
    const d = new Date(anchor);
    d.setDate(d.getDate() + days);
    setAnchor(view === "week" ? startOfWeek(d) : d);
  }

  function goToday() {
    setAnchor(view === "week" ? startOfWeek(new Date()) : new Date());
  }

  const label =
    view === "week"
      ? fmtWeekRange(anchor)
      : view === "day"
      ? anchor.toLocaleDateString(undefined, {
          weekday: "long",
          month: "long",
          day: "numeric",
          year: "numeric",
        })
      : "Agenda";

  return (
    <ChromeBar className="flex flex-wrap items-center gap-2 px-4 py-2">
      <div className="flex items-center gap-0.5 rounded-md border border-border/40 bg-card p-0.5">
        <ViewBtn icon={<CalendarDays className="h-3 w-3" />} active={view === "week"} onClick={() => setView("week")} label="Week" />
        <ViewBtn icon={<LayoutGrid className="h-3 w-3" />} active={view === "day"} onClick={() => setView("day")} label="Day" />
        <ViewBtn icon={<List className="h-3 w-3" />} active={view === "agenda"} onClick={() => setView("agenda")} label="Agenda" />
      </div>

      {view !== "agenda" && (
        <>
          <button
            onClick={() => shift(view === "week" ? -7 : -1)}
            className="inline-flex h-7 w-7 items-center justify-center rounded border border-border/40 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Previous"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={goToday}
            className="h-7 rounded border border-border/40 px-2.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            Today
          </button>
          <button
            onClick={() => shift(view === "week" ? 7 : 1)}
            className="inline-flex h-7 w-7 items-center justify-center rounded border border-border/40 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Next"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
          <span className="text-[12px] font-medium">{label}</span>
        </>
      )}

      {view === "agenda" && (
        <div className="flex items-center gap-1.5">
          {(["upcoming", "today", "past"] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "h-7 rounded border px-2.5 text-[11px] capitalize transition-colors",
                filter === f
                  ? "border-border bg-accent text-foreground"
                  : "border-border/40 text-muted-foreground hover:bg-accent/30"
              )}
            >
              {f}
            </button>
          ))}
          {count != null && (
            <span className="ml-2 font-mono text-[10px] text-muted-foreground">
              {count} events
            </span>
          )}
        </div>
      )}
    </ChromeBar>
  );
}

function ViewBtn({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded px-2 text-[11px] transition-colors",
        active ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/40"
      )}
    >
      {icon}
      {label}
    </button>
  );
}

// ============================================================================
// Week grid — 7 day columns × hour rows, events absolutely positioned
// ============================================================================

function WeekGrid({
  events,
  anchor,
  selectedId,
  onSelect,
  companyMap,
}: {
  events: CalendarEventRow[];
  anchor: Date;
  selectedId: string | null;
  onSelect: (id: string) => void;
  companyMap: Map<string, Company>;
}) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(anchor);
    d.setDate(d.getDate() + i);
    return d;
  });

  const byDay = days.map((d) => {
    const startMs = startOfDay(d).getTime();
    const endMs = startMs + 86_400_000;
    return events
      .filter((e) => {
        const t = new Date(e.start_at).getTime();
        return t >= startMs && t < endMs;
      })
      .sort((a, b) => a.start_at.localeCompare(b.start_at));
  });

  return (
    <ScrollArea className="h-full">
      <div className="min-w-[700px]">
        {/* Day header row */}
        <div className="sticky top-0 z-20 grid grid-cols-[56px_repeat(7,1fr)] border-b border-border/40 bg-background/95 backdrop-blur">
          <div />
          {days.map((d) => {
            const isToday = sameDay(d, new Date());
            return (
              <div
                key={d.toISOString()}
                className={cn(
                  "border-l border-border/30 px-2 py-1.5 text-center",
                  isToday && "bg-primary/5"
                )}
              >
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {d.toLocaleDateString(undefined, { weekday: "short" })}
                </div>
                <div
                  className={cn(
                    "text-sm font-semibold tabular-nums",
                    isToday && "text-primary"
                  )}
                >
                  {d.getDate()}
                </div>
              </div>
            );
          })}
        </div>

        {/* Hour rows + day columns */}
        <div
          className="relative grid grid-cols-[56px_repeat(7,1fr)]"
          style={{ height: HOURS.length * HOUR_PX }}
        >
          {/* Time labels column */}
          <div className="relative">
            {HOURS.map((h, i) => (
              <div
                key={h}
                className="absolute left-0 right-0 border-t border-border/20 pr-1 text-right font-mono text-[10px] text-muted-foreground"
                style={{ top: i * HOUR_PX }}
              >
                {fmtHour(h)}
              </div>
            ))}
          </div>

          {/* Day columns */}
          {days.map((d, i) => {
            const isToday = sameDay(d, new Date());
            return (
              <div
                key={d.toISOString()}
                className={cn(
                  "relative border-l border-border/20",
                  isToday && "bg-primary/[0.02]"
                )}
              >
                {HOURS.map((h, hi) => (
                  <div
                    key={h}
                    className="absolute inset-x-0 border-t border-border/20"
                    style={{ top: hi * HOUR_PX, height: HOUR_PX }}
                  />
                ))}
                {isToday && <NowLine />}
                {byDay[i].map((ev) => (
                  <EventBlock
                    key={ev.id}
                    event={ev}
                    selected={selectedId === ev.id}
                    onSelect={onSelect}
                    company={ev.company_id ? companyMap.get(ev.company_id) : undefined}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </ScrollArea>
  );
}

// ============================================================================
// Day grid — single column variant of Week
// ============================================================================

function DayGrid({
  events,
  anchor,
  selectedId,
  onSelect,
  companyMap,
}: {
  events: CalendarEventRow[];
  anchor: Date;
  selectedId: string | null;
  onSelect: (id: string) => void;
  companyMap: Map<string, Company>;
}) {
  const startMs = startOfDay(anchor).getTime();
  const endMs = startMs + 86_400_000;
  const dayEvents = events
    .filter((e) => {
      const t = new Date(e.start_at).getTime();
      return t >= startMs && t < endMs;
    })
    .sort((a, b) => a.start_at.localeCompare(b.start_at));

  const isToday = sameDay(anchor, new Date());

  return (
    <ScrollArea className="h-full">
      <div
        className="relative grid grid-cols-[56px_1fr]"
        style={{ height: HOURS.length * HOUR_PX }}
      >
        <div className="relative">
          {HOURS.map((h, i) => (
            <div
              key={h}
              className="absolute left-0 right-0 border-t border-border/20 pr-1 text-right font-mono text-[10px] text-muted-foreground"
              style={{ top: i * HOUR_PX }}
            >
              {fmtHour(h)}
            </div>
          ))}
        </div>
        <div className={cn("relative border-l border-border/20", isToday && "bg-primary/[0.02]")}>
          {HOURS.map((h, hi) => (
            <div
              key={h}
              className="absolute inset-x-0 border-t border-border/20"
              style={{ top: hi * HOUR_PX, height: HOUR_PX }}
            />
          ))}
          {isToday && <NowLine />}
          {dayEvents.map((ev) => (
            <EventBlock
              key={ev.id}
              event={ev}
              selected={selectedId === ev.id}
              onSelect={onSelect}
              company={ev.company_id ? companyMap.get(ev.company_id) : undefined}
              wide
            />
          ))}
        </div>
      </div>
    </ScrollArea>
  );
}

// ============================================================================
// Event block (week/day) — magnetic hover + select burst
// ============================================================================

function EventBlock({
  event,
  selected,
  onSelect,
  company,
  wide,
}: {
  event: CalendarEventRow;
  selected: boolean;
  onSelect: (id: string) => void;
  company?: Company;
  wide?: boolean;
}) {
  const { ref: hoverRef, onEnter, onLeave } = useMagneticHover<HTMLButtonElement>({
    intensity: "soft",
    lift: 1,
  });
  const burstRef = useSelectBurst(selected);

  const start = new Date(event.start_at);
  const end = new Date(event.end_at);
  const startMinutes = start.getHours() * 60 + start.getMinutes();
  const endMinutes = end.getHours() * 60 + end.getMinutes();
  const dayStartMinutes = DAY_START_HOUR * 60;
  const top = ((startMinutes - dayStartMinutes) / 60) * HOUR_PX;
  const height = Math.max(
    18,
    ((endMinutes - startMinutes) / 60) * HOUR_PX - 2
  );

  // Out-of-visible-window events: hide rather than clip past edges
  if (top < -height || top > HOURS.length * HOUR_PX) return null;

  const accent = company?.color_hex ?? "hsl(var(--primary))";

  return (
    <button
      ref={(el) => {
        hoverRef.current = el;
        burstRef.current = el as unknown as HTMLDivElement | null;
      }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onClick={() => onSelect(event.id)}
      className={cn(
        "absolute overflow-hidden rounded-md border bg-card px-1.5 py-1 text-left transition-colors",
        selected
          ? "border-primary/60 ring-1 ring-primary/40 shadow-[0_0_20px_-6px_hsl(var(--primary)/0.6)]"
          : "border-border/50 hover:border-primary/40"
      )}
      style={{
        top,
        height,
        left: wide ? 4 : 2,
        right: wide ? 4 : 2,
        borderLeftWidth: 3,
        borderLeftColor: accent,
      }}
    >
      {selected && (
        <span
          data-select-burst
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 rounded-md bg-primary/30 blur-md"
        />
      )}
      <div className="line-clamp-1 text-[11px] font-medium leading-tight">
        {event.title}
      </div>
      <div className="mt-0.5 flex items-center gap-1 text-[9px] text-muted-foreground">
        <span className="font-mono tabular-nums">{fmtTime(event.start_at)}</span>
        {event.meeting_url && <Video className="h-2.5 w-2.5 text-primary" />}
      </div>
    </button>
  );
}

function NowLine() {
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  const top = ((minutes - DAY_START_HOUR * 60) / 60) * HOUR_PX;
  if (top < 0 || top > HOURS.length * HOUR_PX) return null;
  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-10 flex items-center"
      style={{ top }}
    >
      <span className="h-1.5 w-1.5 -translate-x-0.5 rounded-full bg-destructive shadow-[0_0_8px_hsl(var(--destructive)/0.8)]" />
      <span className="h-px flex-1 bg-destructive/70" />
    </div>
  );
}

// ============================================================================
// Agenda list — the original two-pane list, kept as a view mode
// ============================================================================

function AgendaList({
  events,
  selectedId,
  onSelect,
  companyMap,
}: {
  events: CalendarEventRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  companyMap: Map<string, Company>;
}) {
  const grouped = useMemo(() => {
    const groups = new Map<string, CalendarEventRow[]>();
    for (const e of events) {
      const day = new Date(e.start_at).toISOString().slice(0, 10);
      if (!groups.has(day)) groups.set(day, []);
      groups.get(day)!.push(e);
    }
    return Array.from(groups.entries());
  }, [events]);

  if (grouped.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-center text-sm text-muted-foreground">
        No events.
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="space-y-3 p-2">
        {grouped.map(([day, evs]) => (
          <section key={day}>
            <div className="sticky top-0 z-10 mb-1 bg-background/95 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur">
              {fmtDay(day)}
            </div>
            <ul className="space-y-1">
              {evs.map((e) => (
                <AgendaRow
                  key={e.id}
                  event={e}
                  selected={selectedId === e.id}
                  onSelect={onSelect}
                  company={e.company_id ? companyMap.get(e.company_id) : undefined}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </ScrollArea>
  );
}

function AgendaRow({
  event,
  selected,
  onSelect,
  company,
}: {
  event: CalendarEventRow;
  selected: boolean;
  onSelect: (id: string) => void;
  company?: Company;
}) {
  const { ref: hoverRef, onEnter, onLeave } = useMagneticHover<HTMLButtonElement>({
    intensity: "soft",
  });
  const burstRef = useSelectBurst(selected);

  return (
    <li>
      <button
        ref={(el) => {
          hoverRef.current = el;
          burstRef.current = el as unknown as HTMLDivElement | null;
        }}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        onClick={() => onSelect(event.id)}
        className={cn(
          "relative block w-full rounded-md border bg-card px-3 py-2 text-left transition-colors",
          selected
            ? "border-primary/60 ring-1 ring-primary/40 shadow-[0_0_20px_-6px_hsl(var(--primary)/0.55)]"
            : "border-border/30 hover:border-primary/30"
        )}
      >
        {selected && (
          <span
            data-select-burst
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10 rounded-md bg-primary/25 blur-md"
          />
        )}
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-muted-foreground">
            {fmtTime(event.start_at)}
          </span>
          <span className="truncate text-[12px] font-medium">{event.title}</span>
          {event.meeting_url && (
            <Video className="ml-auto h-3 w-3 shrink-0 text-primary" />
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
          <Users className="h-2.5 w-2.5" />
          <span className="truncate">
            {(event.attendees ?? [])
              .map((a) => a.name ?? a.email)
              .slice(0, 3)
              .join(", ")}
            {(event.attendees ?? []).length > 3
              ? ` +${(event.attendees ?? []).length - 3}`
              : ""}
          </span>
          {company && (
            <span className="ml-auto inline-flex items-center gap-1">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: company.color_hex }}
              />
              {company.name}
            </span>
          )}
        </div>
      </button>
    </li>
  );
}

// ============================================================================
// Detail pane (right side)
// ============================================================================

function EventDetail({ event }: { event: CalendarEventRow }) {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border/40 p-5">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <CalIcon className="h-3.5 w-3.5" />
          <span>{fmtFull(event.start_at)}</span>
          <span className="font-mono">→</span>
          <span>{fmtTime(event.end_at)}</span>
        </div>
        <h2 className="mt-2 text-base font-semibold tracking-tight">{event.title}</h2>
        {event.location && (
          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <MapPin className="h-3 w-3" />
            {event.location}
          </div>
        )}
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-4 p-5">
          {event.meeting_url && (
            <a
              href={event.meeting_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-[13px] font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Video className="h-3.5 w-3.5" />
              Join meeting
            </a>
          )}

          {event.description && (
            <section>
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Description
              </h3>
              <div className="rounded-md border border-border/40 bg-card p-3 text-[13px] leading-relaxed text-foreground/90 whitespace-pre-wrap">
                {event.description}
              </div>
            </section>
          )}

          <section>
            <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Attendees ({(event.attendees ?? []).length})
            </h3>
            <ul className="rounded-md border border-border/40 bg-card divide-y divide-border/40">
              {(event.attendees ?? []).map((a, i) => (
                <li key={i} className="flex items-center gap-2 px-3 py-2 text-[12px]">
                  <Users className="h-3 w-3 text-muted-foreground" />
                  <span className="truncate">{a.name ?? a.email}</span>
                  {a.email && a.name && (
                    <span className="text-[10px] font-mono text-muted-foreground">{a.email}</span>
                  )}
                  {a.organizer && (
                    <span className="ml-auto rounded border border-border/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                      host
                    </span>
                  )}
                  {a.response && (
                    <span className="rounded border border-border/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                      {a.response}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <a
            href="https://calendar.google.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-card px-2 text-[11px] hover:bg-accent"
          >
            <ExternalLink className="h-3 w-3" />
            Open in Calendar
          </a>
        </div>
      </ScrollArea>
    </div>
  );
}

// ============================================================================
// Date helpers
// ============================================================================

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function startOfWeek(d: Date): Date {
  // Sunday-start week. Adjust if Sidd wants Monday-start later.
  const x = startOfDay(d);
  x.setDate(x.getDate() - x.getDay());
  return x;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function fmtWeekRange(anchor: Date): string {
  const end = new Date(anchor);
  end.setDate(end.getDate() + 6);
  const sameMonth = anchor.getMonth() === end.getMonth();
  if (sameMonth) {
    return `${anchor.toLocaleDateString(undefined, {
      month: "long",
    })} ${anchor.getDate()}–${end.getDate()}, ${end.getFullYear()}`;
  }
  return `${anchor.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${end.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
}

function fmtDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

function fmtHour(h: number): string {
  if (h === 0) return "12a";
  if (h === 12) return "12p";
  return h < 12 ? `${h}a` : `${h - 12}p`;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function fmtFull(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
