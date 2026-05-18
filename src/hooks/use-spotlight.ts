"use client";

/**
 * Shared search-hit computation used by both /search (full page) and
 * the ⌘K spotlight modal. Keyword search runs client-side over the
 * already-cached TanStack Query data — no network round-trip on
 * keystroke. Returns ranked, grouped hits.
 */
import { useEffect, useMemo, useState } from "react";
import { useInboxMessages } from "@/hooks/use-inbox";
import { useMeetings } from "@/hooks/use-meetings";
import { useLinearIssues } from "@/hooks/use-linear-issues";
import { useCalendarEvents } from "@/hooks/use-calendar";
import { useS2DItems } from "@/hooks/use-s2d";

export type SpotlightSource =
  | "s2d"
  | "gmail"
  | "slack"
  | "linear"
  | "fireflies"
  | "calendar";

export interface SpotlightHit {
  source: SpotlightSource;
  id: string;
  title: string;
  snippet: string;
  meta: string;
  href: string;
  external?: boolean;
}

const MAX_TOTAL = 200;

/**
 * Hook: returns debounced query state + grouped hits.
 *
 * @param initialDelayMs — debounce on keystroke. 120 is snappy enough
 *   that typing feels live; lower causes wasteful work on every key.
 */
export function useSpotlight(initialDelayMs = 120) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const t = setTimeout(
      () => setDebounced(query.trim().toLowerCase()),
      initialDelayMs,
    );
    return () => clearTimeout(t);
  }, [query, initialDelayMs]);

  const { data: messages = [] } = useInboxMessages();
  const { data: meetings = [] } = useMeetings();
  const { data: issues = [] } = useLinearIssues();
  const { data: events = [] } = useCalendarEvents();
  const { data: s2d = [] } = useS2DItems();

  const hits: SpotlightHit[] = useMemo(() => {
    if (!debounced) return [];
    const q = debounced;
    const out: SpotlightHit[] = [];

    for (const it of s2d) {
      const hay = `${it.title}\n${it.description ?? ""}`.toLowerCase();
      if (hay.includes(q)) {
        const ticketLabel = it.ticket_number
          ? `MASH-${it.ticket_number}`
          : it.id.slice(0, 8);
        out.push({
          source: "s2d",
          id: it.id,
          title: it.title,
          snippet: it.description?.slice(0, 200) ?? "",
          meta: `${ticketLabel} · ${it.status} · ${it.pathway}`,
          href: `/s2d?item=${it.id}`,
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
          meta: m.sender_name ?? m.sender_email ?? "—",
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

    return out.slice(0, MAX_TOTAL);
  }, [debounced, s2d, messages, meetings, issues, events]);

  const grouped = useMemo(() => {
    const map = new Map<SpotlightSource, SpotlightHit[]>();
    for (const h of hits) {
      if (!map.has(h.source)) map.set(h.source, []);
      map.get(h.source)!.push(h);
    }
    // Stable display order — board first because that's the unified view.
    const order: SpotlightSource[] = [
      "s2d",
      "linear",
      "fireflies",
      "calendar",
      "gmail",
      "slack",
    ];
    return order
      .filter((s) => map.has(s))
      .map((s) => [s, map.get(s)!] as const);
  }, [hits]);

  return { query, setQuery, debounced, hits, grouped };
}

export const SPOTLIGHT_SOURCE_META = {
  s2d: { label: "S2D", color: "text-primary" },
  gmail: { label: "Gmail", color: "text-rose-400" },
  slack: { label: "Slack", color: "text-violet-400" },
  linear: { label: "Linear", color: "text-indigo-300" },
  fireflies: { label: "Meetings", color: "text-orange-400" },
  calendar: { label: "Calendar", color: "text-sky-400" },
} as const;
