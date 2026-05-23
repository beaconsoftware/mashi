"use client";

// translucency-audit-ok: file — legacy callsites, migrate to sanctioned scale (/15, /40, /55, /60, /80, /95) case-by-case during component touch-ups.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Search,
  Mail,
  MessageSquare,
  GitBranch,
  Mic,
  Calendar as CalIcon,
  KanbanSquare,
  ExternalLink,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useInboxMessages } from "@/hooks/use-inbox";
import { useMeetings } from "@/hooks/use-meetings";
import { useLinearIssues } from "@/hooks/use-linear-issues";
import { useCalendarEvents } from "@/hooks/use-calendar";
import { useS2DItems } from "@/hooks/use-s2d";
import { cn } from "@/lib/utils";

type Hit = {
  source: "s2d" | "gmail" | "slack" | "linear" | "fireflies" | "calendar";
  id: string;
  title: string;
  snippet: string;
  meta: string;
  href: string;
  external?: boolean;
};

const SOURCE_META = {
  s2d: { icon: KanbanSquare, label: "S2D", color: "text-primary" },
  gmail: { icon: Mail, label: "Gmail", color: "text-rose-400" },
  slack: { icon: MessageSquare, label: "Slack", color: "text-violet-400" },
  linear: { icon: GitBranch, label: "Linear", color: "text-indigo-300" },
  fireflies: { icon: Mic, label: "Meetings", color: "text-orange-400" },
  calendar: { icon: CalIcon, label: "Calendar", color: "text-sky-400" },
} as const;

export function SearchView() {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim().toLowerCase()), 150);
    return () => clearTimeout(t);
  }, [query]);

  const { data: messages = [] } = useInboxMessages();
  const { data: meetings = [] } = useMeetings();
  const { data: issues = [] } = useLinearIssues();
  const { data: events = [] } = useCalendarEvents();
  const { data: s2d = [] } = useS2DItems();

  const hits: Hit[] = useMemo(() => {
    if (!debounced) return [];
    const q = debounced;
    const out: Hit[] = [];

    for (const it of s2d) {
      const hay = `${it.title}\n${it.description ?? ""}`.toLowerCase();
      if (hay.includes(q)) {
        out.push({
          source: "s2d",
          id: it.id,
          title: it.title,
          snippet: it.description?.slice(0, 200) ?? "",
          meta: `${it.status} · ${it.pathway}`,
          href: `/s2d`,
        });
      }
    }
    for (const m of messages) {
      const hay = `${m.subject ?? ""}\n${m.preview ?? ""}\n${m.sender_name ?? ""}\n${m.sender_email ?? ""}`.toLowerCase();
      if (hay.includes(q)) {
        out.push({
          source: m.source,
          id: m.id,
          title: m.subject ?? m.channel ?? "(no subject)",
          snippet: m.preview?.slice(0, 200) ?? "",
          meta: `${m.sender_name ?? m.sender_email ?? "—"}`,
          href: `/inbox`,
        });
      }
    }
    for (const m of meetings) {
      const hay = `${m.title ?? ""}\n${m.summary ?? ""}\n${(m.attendees ?? []).map((a) => a.name ?? a.email ?? "").join(" ")}`.toLowerCase();
      if (hay.includes(q)) {
        out.push({
          source: "fireflies",
          id: m.id,
          title: m.title ?? "(untitled meeting)",
          snippet: m.summary?.slice(0, 200) ?? "",
          meta: m.date ? new Date(m.date).toLocaleDateString() : "",
          href: `/notes`,
        });
      }
    }
    for (const it of issues) {
      const hay = `${it.title}\n${it.description ?? ""}\n${it.assignee_name ?? ""}`.toLowerCase();
      if (hay.includes(q)) {
        out.push({
          source: "linear",
          id: it.id,
          title: it.title,
          snippet: it.description?.slice(0, 200) ?? "",
          meta: `${it.status} · ${it.assignee_name ?? "unassigned"}`,
          href: it.url ?? `/linear`,
          external: !!it.url,
        });
      }
    }
    for (const e of events) {
      const hay = `${e.title}\n${e.description ?? ""}\n${(e.attendees ?? []).map((a) => a.name ?? a.email).join(" ")}`.toLowerCase();
      if (hay.includes(q)) {
        out.push({
          source: "calendar",
          id: e.id,
          title: e.title,
          snippet: e.description?.slice(0, 200) ?? "",
          meta: new Date(e.start_at).toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          }),
          href: `/calendar`,
        });
      }
    }

    return out.slice(0, 200);
  }, [debounced, s2d, messages, meetings, issues, events]);

  const grouped = useMemo(() => {
    const map = new Map<Hit["source"], Hit[]>();
    for (const h of hits) {
      if (!map.has(h.source)) map.set(h.source, []);
      map.get(h.source)!.push(h);
    }
    return Array.from(map.entries());
  }, [hits]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border/40 p-4">
        <div className="relative mx-auto max-w-2xl">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search across S2D, Gmail, Slack, Linear, meetings, calendar…"
            className="h-10 pl-9 text-sm"
            autoFocus
          />
          {debounced && (
            <div className="mt-1.5 text-center text-[11px] text-muted-foreground">
              {hits.length} result{hits.length === 1 ? "" : "s"}
            </div>
          )}
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-3xl px-4 py-6 space-y-6">
          {!debounced ? (
            <div className="text-center text-sm text-muted-foreground">
              Type to search. Keyword search runs locally over your synced data.
            </div>
          ) : hits.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground">
              Nothing found for &quot;{query}&quot;.
            </div>
          ) : (
            grouped.map(([source, list]) => {
              const meta = SOURCE_META[source];
              const Icon = meta.icon;
              return (
                <section key={source}>
                  <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <Icon className={cn("h-3.5 w-3.5", meta.color)} />
                    {meta.label}
                    <span className="font-mono text-[10px] opacity-70">{list.length}</span>
                  </div>
                  <ul className="rounded-md border border-border/40 bg-card divide-y divide-border/40">
                    {list.map((h) => (
                      <li key={`${h.source}-${h.id}`}>
                        {h.external ? (
                          <a
                            href={h.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-start gap-2 px-3 py-2 transition-colors hover:bg-accent/30"
                          >
                            <HitContent hit={h} query={debounced} />
                            <ExternalLink className="mt-1 h-3 w-3 shrink-0 text-muted-foreground" />
                          </a>
                        ) : (
                          <Link
                            href={h.href}
                            className="flex items-start gap-2 px-3 py-2 transition-colors hover:bg-accent/30"
                          >
                            <HitContent hit={h} query={debounced} />
                          </Link>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function HitContent({ hit, query }: { hit: Hit; query: string }) {
  return (
    <div className="flex-1 min-w-0">
      <div className="line-clamp-1 text-[13px] font-medium text-foreground/90">
        {highlight(hit.title, query)}
      </div>
      {hit.snippet && (
        <div className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
          {highlight(hit.snippet, query)}
        </div>
      )}
      <div className="mt-0.5 text-[10px] font-mono text-muted-foreground/70">{hit.meta}</div>
    </div>
  );
}

function highlight(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query);
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-primary/30 text-foreground">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}
