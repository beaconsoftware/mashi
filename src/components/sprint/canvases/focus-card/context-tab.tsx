"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Calendar,
  ExternalLink,
  GitBranch,
  Inbox,
  KanbanSquare,
  MessageSquare,
  CornerDownRight,
  Gavel,
  ListChecks,
  ScrollText,
} from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  useEnrichedContext,
  type EnrichSourceKind,
} from "@/hooks/use-enriched-context";
import { useWatchCheckIns } from "@/hooks/use-watch-check-ins";
import { useS2DItems } from "@/hooks/use-s2d";
import { cn } from "@/lib/utils";
import type { S2DItem } from "@/types";

/**
 * Context tab — read-only sectioned view that surfaces what the agent
 * has cached for this item so the user can scan provenance without
 * leaving the slot. Each section renders conditionally based on
 * whether its underlying data is non-empty.
 */
export function ContextTab({ item }: { item: S2DItem }) {
  const enriched = useEnrichedContext(item.id);
  const sources = enriched.data?.enriched_context?.pulled_sources ?? [];

  const checkIns = useWatchCheckIns(item.id);
  const lastCheckIn = checkIns.data?.history?.[0] ?? null;

  const { data: allItems } = useS2DItems();
  const related = (allItems ?? []).filter(
    (i) =>
      (item.spawned_from_item_id && i.id === item.spawned_from_item_id) ||
      i.spawned_from_item_id === item.id
  );

  const sourceThread = useSourceThreadPreview(item);

  const hasDecision = !!item.decision_log || !!item.decision_note;

  const anyContent =
    sources.length > 0 ||
    hasDecision ||
    !!lastCheckIn ||
    related.length > 0 ||
    !!sourceThread.data;

  if (!anyContent) {
    return (
      <div className="rounded-md border border-dashed border-border/40 bg-card/60 p-3 text-[11px] text-muted-foreground">
        No cached context yet. Try Ask Mashi in the Chat tab to pull
        sources, log a decision, or check in.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {sources.length > 0 && (
        <Section title="Sources" icon={<Layers />}>
          <ul className="space-y-1.5">
            {sources.slice(0, 8).map((s, idx) => (
              <li
                key={`${s.kind}-${s.ref}-${idx}`}
                className="rounded border border-border/40 bg-card/80 px-2 py-1.5 text-[11px] leading-snug"
              >
                <div className="mb-0.5 flex items-center gap-1.5 text-muted-foreground">
                  <SourceIcon kind={s.kind} />
                  <span className="font-mono text-[10px] uppercase tracking-wider">
                    {s.kind}
                  </span>
                  <span className="truncate text-foreground/80">{s.label}</span>
                </div>
                {s.snippet && (
                  <p className="line-clamp-2 text-foreground/80">
                    {s.snippet}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {hasDecision && (
        <Section title="Last decision" icon={<Gavel />}>
          <div className="rounded border border-border/40 bg-card/80 px-2 py-1.5 text-[11px] leading-snug">
            {item.decision_at && (
              <div className="mb-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {formatWhen(item.decision_at)}
              </div>
            )}
            {item.decision_note && (
              <p className="whitespace-pre-wrap text-foreground/90">
                {item.decision_note}
              </p>
            )}
            {item.decision_log && (
              <DecisionPreview log={item.decision_log} />
            )}
          </div>
        </Section>
      )}

      {lastCheckIn && (
        <Section title="Last check-in" icon={<ListChecks />}>
          <div className="rounded border border-border/40 bg-card/80 px-2 py-1.5 text-[11px] leading-snug">
            <div className="mb-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {formatWhen(lastCheckIn.at)}
              {lastCheckIn.continued ? " · continued" : " · resolved"}
            </div>
            {lastCheckIn.note && (
              <p className="whitespace-pre-wrap text-foreground/90">
                {lastCheckIn.note}
              </p>
            )}
          </div>
        </Section>
      )}

      {related.length > 0 && (
        <Section title="Related items" icon={<CornerDownRight />}>
          <ul className="space-y-1">
            {related.map((r) => (
              <li
                key={r.id}
                className="flex items-center gap-1.5 rounded border border-border/40 bg-card/80 px-2 py-1 text-[11px]"
              >
                <span className="font-mono text-[10px] text-primary">
                  MASH-{r.ticket_number}
                </span>
                <span className="truncate text-foreground/80">{r.title}</span>
                <span
                  className={cn(
                    "ml-auto rounded px-1 py-0.5 font-mono text-[9px] uppercase tracking-wider",
                    r.spawned_from_item_id === item.id
                      ? "bg-secondary/60 text-muted-foreground"
                      : "bg-primary/15 text-primary"
                  )}
                >
                  {r.spawned_from_item_id === item.id ? "spawned" : "parent"}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {sourceThread.data && (
        <Section title="Source thread" icon={<ScrollText />}>
          <div className="rounded border border-border/40 bg-card/80 px-2 py-1.5 text-[11px] leading-snug">
            <div className="mb-1 flex items-center gap-1.5 text-muted-foreground">
              <SourceIcon kind={sourceThread.data.kind} />
              <span className="truncate text-foreground/80">
                {sourceThread.data.subject ?? "(no subject)"}
              </span>
              {item.source_url && (
                <a
                  href={item.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-auto inline-flex items-center gap-0.5 text-primary hover:underline"
                  title="Open in source app"
                >
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
            <ul className="space-y-1">
              {sourceThread.data.snippets.map((m, i) => (
                <li
                  key={i}
                  className="rounded border border-border/30 bg-card/60 px-1.5 py-1"
                >
                  <div className="mb-0.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                    {m.sender ?? "unknown"} · {formatWhen(m.at)}
                  </div>
                  <p className="line-clamp-2 text-foreground/80">{m.text}</p>
                </li>
              ))}
            </ul>
          </div>
        </Section>
      )}
    </div>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-1 flex items-center gap-1.5 px-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <span className="text-foreground/70">{icon}</span>
        {title}
      </div>
      {children}
    </section>
  );
}

function Layers() {
  return <KanbanSquare className="h-3 w-3" />;
}

const KIND_ICON: Record<EnrichSourceKind, React.ComponentType<{ className?: string }>> = {
  gmail: Inbox,
  slack: MessageSquare,
  linear: GitBranch,
  fireflies: Calendar,
  s2d: KanbanSquare,
};

function SourceIcon({ kind }: { kind: EnrichSourceKind }) {
  const Icon = KIND_ICON[kind] ?? KanbanSquare;
  return <Icon className="h-3 w-3" />;
}

function DecisionPreview({ log }: { log: Record<string, unknown> }) {
  const choice = typeof log.choice === "string" ? log.choice : null;
  const condition = typeof log.condition === "string" ? log.condition : null;
  if (!choice && !condition) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5">
      {choice && (
        <span className="rounded bg-primary/15 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-primary">
          {choice}
        </span>
      )}
      {condition && (
        <span className="text-[11px] text-foreground/80">if {condition}</span>
      )}
    </div>
  );
}

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diff = Date.now() - d.getTime();
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

interface ThreadPreview {
  kind: EnrichSourceKind;
  subject: string | null;
  snippets: { sender: string | null; at: string | null; text: string }[];
}

function useSourceThreadPreview(item: S2DItem) {
  const eligible =
    (item.source_type === "gmail" || item.source_type === "slack") &&
    !!item.source_thread_id;
  return useQuery({
    queryKey: ["focus-card-source-thread", item.id, item.source_thread_id],
    enabled: eligible,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ThreadPreview | null> => {
      const sb = createSupabaseBrowserClient();
      const { data, error } = await sb
        .from("messages")
        .select("subject, sender_name, sender_email, preview, full_content, received_at")
        .eq("source", item.source_type as string)
        .eq("thread_id", item.source_thread_id as string)
        .order("received_at", { ascending: false })
        .limit(3);
      if (error) return null;
      const rows =
        (data as Array<{
          subject: string | null;
          sender_name: string | null;
          sender_email: string | null;
          preview: string | null;
          full_content: string | null;
          received_at: string | null;
        }> | null) ?? [];
      if (rows.length === 0) return null;
      return {
        kind: item.source_type as EnrichSourceKind,
        subject: rows.find((r) => r.subject)?.subject ?? null,
        snippets: rows.map((r) => ({
          sender: r.sender_name ?? r.sender_email,
          at: r.received_at,
          text: (r.preview ?? r.full_content ?? "").slice(0, 240),
        })),
      };
    },
  });
}
