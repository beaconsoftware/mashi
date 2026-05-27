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
  type EnrichPulledSource,
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
  const visibleSources = sources.slice(0, 8);
  const deepLinks = useSourceDeepLinks(visibleSources);

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
      {visibleSources.length > 0 && (
        <Section title="Sources" icon={<Layers />}>
          <ul className="space-y-1.5">
            {visibleSources.map((s, idx) => {
              const url = deepLinks.get(`${s.kind}:${s.ref}`) ?? null;
              return (
                <li
                  key={`${s.kind}-${s.ref}-${idx}`}
                  className="rounded border border-border/40 bg-card/80 px-2 py-1.5 text-[11px] leading-snug"
                >
                  <div className="mb-0.5 flex items-center gap-1.5 text-muted-foreground">
                    <SourceIcon kind={s.kind} />
                    <span className="font-mono text-[10px] uppercase tracking-wider">
                      {s.kind}
                    </span>
                    <span className="truncate text-foreground/80">
                      {s.label}
                    </span>
                    {url && (
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mashi-press ml-auto inline-flex shrink-0 items-center gap-0.5 text-primary hover:underline"
                        title={`Open in ${labelForKind(s.kind)}`}
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                  {s.snippet && (
                    <p className="line-clamp-2 text-foreground/80">
                      {s.snippet}
                    </p>
                  )}
                </li>
              );
            })}
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
                <a
                  href={`/s2d?focus=${encodeURIComponent(r.id)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mashi-press flex min-w-0 flex-1 items-center gap-1.5 hover:underline"
                  title="Open on the S2D board"
                >
                  <span className="font-mono text-[10px] text-primary">
                    MASH-{r.ticket_number}
                  </span>
                  <span className="truncate text-foreground/80">
                    {r.title}
                  </span>
                </a>
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

function labelForKind(kind: EnrichSourceKind): string {
  switch (kind) {
    case "gmail":
      return "Gmail";
    case "slack":
      return "Slack";
    case "linear":
      return "Linear";
    case "fireflies":
      return "Fireflies";
    case "s2d":
      return "Mashi";
  }
}

/**
 * Resolve a best-effort deep link for each visible source. Different
 * kinds need different lookups since `pulled_sources.ref` was written
 * as the Mashi DB id at enrich time — we have to translate to the
 * upstream id (or url) to build a working external URL.
 *
 *   gmail / slack → look up `messages` by id, build URL from thread_id
 *   linear        → if ref already looks like a URL, use it; else look
 *                   up `linear_issues.url`
 *   fireflies     → look up `meetings.external_id`
 *   s2d           → /s2d?focus=<id> deep-link inside Mashi
 */
function useSourceDeepLinks(
  sources: EnrichPulledSource[]
): Map<string, string> {
  const refsByKind = sources.reduce<Record<EnrichSourceKind, string[]>>(
    (acc, s) => {
      if (!acc[s.kind]) acc[s.kind] = [];
      acc[s.kind].push(s.ref);
      return acc;
    },
    {
      gmail: [],
      slack: [],
      linear: [],
      fireflies: [],
      s2d: [],
    }
  );

  const cacheKey = sources.map((s) => `${s.kind}:${s.ref}`).join("|");

  const { data } = useQuery({
    queryKey: ["focus-card-source-deep-links", cacheKey],
    enabled: sources.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Record<string, string>> => {
      const sb = createSupabaseBrowserClient();
      const out: Record<string, string> = {};

      // Linear: ref may already BE the url (linear_issues.url is preferred
      // at enrich time). If not, lookup by id.
      const linearRefs = refsByKind.linear ?? [];
      const linearUrls = linearRefs.filter((r) => /^https?:\/\//.test(r));
      for (const url of linearUrls) out[`linear:${url}`] = url;
      const linearIds = linearRefs.filter((r) => !/^https?:\/\//.test(r));
      if (linearIds.length > 0) {
        const { data: rows } = await sb
          .from("linear_issues")
          .select("id, url")
          .in("id", linearIds);
        for (const r of rows ?? []) {
          if (r.url) out[`linear:${r.id}`] = r.url as string;
        }
      }

      // Gmail + Slack messages: ref is messages.id; need thread_id +
      // (for slack) the workspace team_id off connected_accounts.
      const msgIds = [
        ...(refsByKind.gmail ?? []),
        ...(refsByKind.slack ?? []),
      ];
      if (msgIds.length > 0) {
        const { data: rows } = await sb
          .from("messages")
          .select("id, source, thread_id, channel, connected_account_id")
          .in("id", msgIds);
        const slackAccountIds = new Set<string>();
        for (const r of rows ?? []) {
          if (r.source === "slack" && r.connected_account_id) {
            slackAccountIds.add(r.connected_account_id as string);
          }
        }
        const teamByAccount = new Map<string, string>();
        if (slackAccountIds.size > 0) {
          const { data: accts } = await sb
            .from("connected_accounts")
            .select("id, raw_provider_data")
            .in("id", Array.from(slackAccountIds));
          for (const a of accts ?? []) {
            const raw = a.raw_provider_data as
              | { team_id?: string; team?: { id?: string } }
              | null;
            const teamId = raw?.team_id ?? raw?.team?.id ?? null;
            if (teamId) teamByAccount.set(a.id as string, teamId);
          }
        }
        for (const r of rows ?? []) {
          if (r.source === "gmail" && r.thread_id) {
            out[`gmail:${r.id}`] =
              `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(
                r.thread_id as string
              )}`;
          } else if (r.source === "slack") {
            const teamId =
              (r.connected_account_id &&
                teamByAccount.get(r.connected_account_id as string)) ||
              null;
            // thread_id is "<channel>:<date>"; the channel id is the
            // first half. Falls back to messages.channel.
            const [channelFromThread] = (r.thread_id ?? "")
              .toString()
              .split(":");
            const channelId = channelFromThread || (r.channel as string | null);
            if (teamId && channelId) {
              out[`slack:${r.id}`] =
                `https://app.slack.com/client/${teamId}/${channelId}`;
            } else if (channelId) {
              out[`slack:${r.id}`] =
                `https://slack.com/app_redirect?channel=${encodeURIComponent(
                  channelId
                )}`;
            }
          }
        }
      }

      // Fireflies meetings: ref is meetings.id, lookup external_id.
      const meetingIds = refsByKind.fireflies ?? [];
      if (meetingIds.length > 0) {
        const { data: rows } = await sb
          .from("meetings")
          .select("id, external_id")
          .in("id", meetingIds);
        for (const r of rows ?? []) {
          if (r.external_id) {
            out[`fireflies:${r.id}`] =
              `https://app.fireflies.ai/view/${encodeURIComponent(
                r.external_id as string
              )}`;
          }
        }
      }

      // S2D: link to the in-app board with the item focused.
      for (const id of refsByKind.s2d ?? []) {
        out[`s2d:${id}`] = `/s2d?focus=${encodeURIComponent(id)}`;
      }

      return out;
    },
  });

  return new Map(Object.entries(data ?? {}));
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
