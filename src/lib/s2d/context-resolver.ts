/**
 * Shared per-item context resolver.
 *
 * Walks an S2DItem's primary source + linked_sources, then resolves each
 * one against the appropriate table to produce a SourceContext bundle.
 *
 * Lives here (not in the /context API route) so the brief consolidator
 * and any other server-side caller can use the same logic without making
 * an internal HTTP hop.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  ContextResp,
  SourceContext,
  GmailMessage,
  SlackMessage,
  LinearIssueLite,
  MeetingLite,
  ActionItemLite,
} from "./claude-prompt";
import type { S2DItem } from "@/types";

type SB = Awaited<ReturnType<typeof createSupabaseServerClient>>;

interface RawLinked {
  source_type?: string | null;
  source_thread_id?: string | null;
  source_label?: string | null;
}

/**
 * Resolve the full SourceContext bundle for an S2D item.
 *
 * The session-scoped Supabase client passed in handles user authorization
 * via RLS, so this function doesn't need to filter user_id manually.
 */
export async function resolveItemContext(
  supabase: SB,
  item: S2DItem
): Promise<ContextResp> {
  const sources: Array<{
    source_type: string;
    source_thread_id: string;
    source_label: string | null;
  }> = [];

  if (item.source_type && item.source_thread_id) {
    sources.push({
      source_type: item.source_type,
      source_thread_id: item.source_thread_id,
      source_label: item.source_label ?? null,
    });
  }
  for (const ls of (item.linked_sources ?? []) as RawLinked[]) {
    if (!ls.source_type || !ls.source_thread_id) continue;
    if (
      sources.some(
        (s) =>
          s.source_type === ls.source_type &&
          s.source_thread_id === ls.source_thread_id
      )
    ) {
      continue;
    }
    sources.push({
      source_type: ls.source_type,
      source_thread_id: ls.source_thread_id,
      source_label: ls.source_label ?? null,
    });
  }

  const resolved: SourceContext[] = [];
  for (const s of sources) {
    resolved.push(await resolveSource(supabase, s));
  }

  return { item, sources: resolved };
}

async function resolveSource(
  supabase: SB,
  src: { source_type: string; source_thread_id: string; source_label: string | null }
): Promise<SourceContext> {
  const base = {
    source_type: src.source_type,
    source_thread_id: src.source_thread_id,
    source_label: src.source_label,
  };

  if (src.source_type === "gmail") {
    const { data: msgs } = await supabase
      .from("messages")
      .select(
        "sender_name, sender_email, subject, full_content, preview, received_at, connected_account_id"
      )
      .eq("source", "gmail")
      .eq("thread_id", src.source_thread_id)
      .order("received_at", { ascending: true })
      .limit(20);

    const messages: GmailMessage[] = (msgs ?? []).map((m) => ({
      from: m.sender_name || m.sender_email || null,
      at: m.received_at ?? null,
      subject: m.subject ?? null,
      body: m.full_content ?? m.preview ?? null,
    }));

    const lastSubject = messages[messages.length - 1]?.subject ?? null;
    const lastBody = messages[messages.length - 1]?.body ?? null;
    const snippet =
      lastSubject || (lastBody ? lastBody.slice(0, 240) : null) || src.source_label;

    return {
      ...base,
      deep_link: `https://mail.google.com/mail/u/0/#inbox/${src.source_thread_id}`,
      snippet,
      details: { kind: "gmail", messages },
    };
  }

  if (src.source_type === "slack") {
    const [convId, dateStr] = src.source_thread_id.split(":");
    const { data: msgs } = await supabase
      .from("messages")
      .select(
        "sender_name, sender_email, channel, full_content, preview, received_at, connected_account_id"
      )
      .eq("source", "slack")
      .eq("thread_id", src.source_thread_id)
      .order("received_at", { ascending: true })
      .limit(20);

    const messages: SlackMessage[] = (msgs ?? []).map((m) => ({
      channel: m.channel ?? null,
      from: m.sender_name || m.sender_email || null,
      at: m.received_at ?? null,
      body: m.full_content ?? m.preview ?? null,
    }));

    let teamId: string | null = null;
    const accountId = msgs?.[0]?.connected_account_id;
    if (accountId) {
      const { data: acct } = await supabase
        .from("connected_accounts")
        .select("raw_provider_data")
        .eq("id", accountId)
        .single();
      teamId =
        (acct?.raw_provider_data as { team_id?: string; team?: { id?: string } } | null)
          ?.team_id ||
        (acct?.raw_provider_data as { team?: { id?: string } } | null)?.team?.id ||
        null;
    }
    const deepLink =
      teamId && convId ? `https://app.slack.com/client/${teamId}/${convId}` : null;

    const last = messages[messages.length - 1];
    const snippet = last?.body
      ? last.body.slice(0, 240)
      : dateStr
        ? `Slack thread (${dateStr})`
        : src.source_label;

    return {
      ...base,
      deep_link: deepLink,
      snippet,
      details: { kind: "slack", messages },
    };
  }

  if (src.source_type === "linear") {
    const { data: issue } = await supabase
      .from("linear_issues")
      .select("title, status, url, description, assignee_name")
      .eq("external_id", src.source_thread_id)
      .maybeSingle();

    const issueLite: LinearIssueLite | null = issue
      ? {
          title: issue.title ?? null,
          status: issue.status ?? null,
          url: issue.url ?? null,
          description: issue.description ?? null,
          assignee_name: issue.assignee_name ?? null,
        }
      : null;

    return {
      ...base,
      deep_link: issueLite?.url ?? null,
      snippet: issueLite?.description
        ? issueLite.description.slice(0, 240)
        : issueLite?.title ?? src.source_label,
      details: { kind: "linear", issue: issueLite },
    };
  }

  if (src.source_type === "fireflies") {
    const { data: meeting } = await supabase
      .from("meetings")
      .select("id, title, date, summary, attendees, external_id")
      .eq("external_id", src.source_thread_id)
      .maybeSingle();

    let actionItems: ActionItemLite[] = [];
    if (meeting?.id) {
      const { data: ai } = await supabase
        .from("action_items")
        .select("description, assignee, status")
        .eq("source_meeting_id", meeting.id);
      actionItems =
        (ai ?? []).map((a) => ({
          description: a.description,
          assignee: a.assignee ?? null,
          status: a.status ?? null,
        })) || [];
    }

    const meetingLite: MeetingLite | null = meeting
      ? {
          title: meeting.title ?? null,
          date: meeting.date ?? null,
          summary: meeting.summary ?? null,
          attendees: meeting.attendees ?? [],
        }
      : null;

    return {
      ...base,
      deep_link: meeting?.external_id
        ? `https://app.fireflies.ai/view/${meeting.external_id}`
        : null,
      snippet:
        meetingLite?.summary?.slice(0, 240) ??
        meetingLite?.title ??
        src.source_label,
      details: { kind: "fireflies", meeting: meetingLite, action_items: actionItems },
    };
  }

  if (src.source_type === "calendar") {
    const { data: ev } = await supabase
      .from("calendar_events")
      .select("title, start_at, meeting_url")
      .eq("external_id", src.source_thread_id)
      .maybeSingle();
    return {
      ...base,
      deep_link: ev?.meeting_url ?? null,
      snippet: ev?.title ?? src.source_label,
      details: {
        kind: "calendar",
        event: ev ? { title: ev.title ?? null, at: ev.start_at ?? null } : null,
      },
    };
  }

  return {
    ...base,
    deep_link: null,
    snippet: src.source_label,
    details: { kind: "other" },
  };
}
