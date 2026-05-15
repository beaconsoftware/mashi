import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/s2d/:id/context
 *
 * Pull every signal Mashi has about a work unit and return it as one
 * consolidated bundle. Used by the detail-sheet "Context" panel and the
 * "Copy as Claude prompt" button.
 *
 * The strategy: take the item's source + every entry in linked_sources
 * (cross-channel merges from triage), then resolve each one against the
 * appropriate table for its source_type. Build deep links per provider.
 */

interface SourceContext {
  source_type: string;
  source_thread_id: string;
  source_label: string | null;
  deep_link: string | null;
  /** Short human-readable summary for inline display. */
  snippet: string | null;
  /** Per-source structured details. */
  details:
    | { kind: "gmail"; messages: GmailMessage[] }
    | { kind: "slack"; messages: SlackMessage[] }
    | { kind: "linear"; issue: LinearIssueLite | null }
    | { kind: "fireflies"; meeting: MeetingLite | null; action_items: ActionItemLite[] }
    | { kind: "calendar"; event: { title: string | null; at: string | null } | null }
    | { kind: "other" };
}

interface GmailMessage {
  from: string | null;
  at: string | null;
  subject: string | null;
  body: string | null;
}
interface SlackMessage {
  channel: string | null;
  from: string | null;
  at: string | null;
  body: string | null;
}
interface LinearIssueLite {
  title: string | null;
  status: string | null;
  url: string | null;
  description: string | null;
  assignee_name: string | null;
}
interface MeetingLite {
  title: string | null;
  date: string | null;
  summary: string | null;
  attendees: unknown;
}
interface ActionItemLite {
  description: string;
  assignee: string | null;
  status: string | null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: item, error: itemErr } = await supabase
    .from("s2d_items")
    .select("*")
    .eq("id", id)
    .single();
  if (itemErr || !item) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  // The "primary" source is what triage first created the item from. Anything
  // in linked_sources represents the same work showing up in other channels.
  type RawLinked = {
    source_type?: string | null;
    source_thread_id?: string | null;
    source_label?: string | null;
  };
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
    // Skip duplicates (same source+thread already in the primary)
    if (
      sources.some(
        (s) =>
          s.source_type === ls.source_type && s.source_thread_id === ls.source_thread_id
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

  return NextResponse.json({
    item,
    sources: resolved,
  });
}

type SB = Awaited<ReturnType<typeof createSupabaseServerClient>>;

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
      .select("sender_name, sender_email, subject, full_content, preview, received_at, connected_account_id")
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
    // source_thread_id format: "<conv_id>:<YYYY-MM-DD>"
    const [convId, dateStr] = src.source_thread_id.split(":");
    const { data: msgs } = await supabase
      .from("messages")
      .select("sender_name, sender_email, channel, full_content, preview, received_at, connected_account_id")
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

    // Resolve team id from connected_accounts.raw_provider_data so we can
    // build a working deep link. If a Slack message exists, use its
    // connected_account_id; otherwise pick any Slack connection.
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
    const deepLink = teamId && convId
      ? `https://app.slack.com/client/${teamId}/${convId}`
      : null;

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
      snippet:
        issueLite?.description
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
      snippet: meetingLite?.summary?.slice(0, 240) ?? meetingLite?.title ?? src.source_label,
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
