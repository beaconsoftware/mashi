import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getActiveAccessToken } from "@/lib/oauth/flow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/connect/slack/[connectionId]/channels
 *
 * Returns the union of public + private channels the user is a member
 * of in the connected Slack workspace, plus the current monitored
 * channel id list (so the UI can render checkboxes pre-selected).
 *
 * Slack's conversations.list with types=public_channel,private_channel
 * paginates 200 at a time. We loop until exhausted but cap at 500
 * channels to avoid a runaway in workspaces with thousands of
 * abandoned channels — by then the user should be using search anyway.
 *
 * PUT /api/connect/slack/[connectionId]/channels
 * Body: { monitored: string[] }
 *
 * Replaces the monitored channel list outright. The diff vs. the
 * current list is purely informational — the sync worker uses
 * raw_provider_data.slack_channel_first_synced to detect "newly added"
 * channels and apply the 7-day bootstrap window on next sync.
 */

interface SlackChannel {
  id: string;
  name?: string;
  is_private?: boolean;
  is_archived?: boolean;
  is_member?: boolean;
  num_members?: number;
  topic?: { value?: string };
  purpose?: { value?: string };
}

const SLACK_API = "https://slack.com/api";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> }
) {
  const { connectionId } = await params;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  // Session client + RLS scopes the connection lookup to this user.
  const { data: conn, error } = await supabase
    .from("connected_accounts")
    .select("id, provider, slack_monitored_channels")
    .eq("id", connectionId)
    .single();
  if (error || !conn || conn.provider !== "slack") {
    return NextResponse.json(
      { error: "Slack connection not found" },
      { status: 404 }
    );
  }

  let token: string;
  try {
    token = await getActiveAccessToken(connectionId);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "couldn't fetch token" },
      { status: 502 }
    );
  }

  const channels: SlackChannel[] = [];
  let cursor: string | undefined;
  const HARD_CAP = 500;
  try {
    do {
      const url = new URL(`${SLACK_API}/users.conversations`);
      url.searchParams.set("types", "public_channel,private_channel");
      url.searchParams.set("exclude_archived", "true");
      url.searchParams.set("limit", "200");
      if (cursor) url.searchParams.set("cursor", cursor);
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const j = (await res.json()) as {
        ok: boolean;
        error?: string;
        channels?: SlackChannel[];
        response_metadata?: { next_cursor?: string };
      };
      if (!j.ok) {
        return NextResponse.json(
          { error: `Slack API: ${j.error ?? "unknown"}` },
          { status: 502 }
        );
      }
      channels.push(...(j.channels ?? []));
      cursor = j.response_metadata?.next_cursor || undefined;
      if (channels.length >= HARD_CAP) break;
    } while (cursor);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "slack fetch failed" },
      { status: 502 }
    );
  }

  // Sort: monitored first, then alphabetical. Makes the picker
  // immediately scannable — you see what you've already chosen at the
  // top, then can browse the rest.
  const monitoredSet = new Set<string>(
    (conn.slack_monitored_channels as unknown[] | null)?.filter(
      (v): v is string => typeof v === "string"
    ) ?? []
  );
  channels.sort((a, b) => {
    const am = monitoredSet.has(a.id) ? 0 : 1;
    const bm = monitoredSet.has(b.id) ? 0 : 1;
    if (am !== bm) return am - bm;
    return (a.name ?? "").localeCompare(b.name ?? "");
  });

  return NextResponse.json({
    monitored: Array.from(monitoredSet),
    channels: channels.map((c) => ({
      id: c.id,
      name: c.name ?? c.id,
      is_private: c.is_private ?? false,
      is_member: c.is_member ?? false,
      num_members: c.num_members ?? null,
      topic: c.topic?.value ?? null,
      purpose: c.purpose?.value ?? null,
    })),
  });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> }
) {
  const { connectionId } = await params;
  const body = (await req.json()) as { monitored?: unknown };
  if (!Array.isArray(body.monitored)) {
    return NextResponse.json(
      { error: "body.monitored must be a string array" },
      { status: 400 }
    );
  }
  const monitored = body.monitored.filter(
    (v): v is string => typeof v === "string" && v.length > 0
  );

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  // RLS gates the update to this user's own connection.
  const { data: conn, error: readErr } = await supabase
    .from("connected_accounts")
    .select("id, provider, raw_provider_data")
    .eq("id", connectionId)
    .single();
  if (readErr || !conn || conn.provider !== "slack") {
    return NextResponse.json(
      { error: "Slack connection not found" },
      { status: 404 }
    );
  }

  // Prune first_synced stamps for channels that have been removed from
  // the monitored list. If the user removes a channel then re-adds it
  // later, they get a fresh 7-day bootstrap — which is the right call,
  // since they were explicitly opting back in. Without pruning, the
  // stale stamp would suppress the backfill on re-add.
  const rawProvider = (conn.raw_provider_data ?? {}) as Record<string, unknown>;
  const firstSynced =
    (rawProvider.slack_channel_first_synced as Record<string, string>) ?? {};
  const nextFirstSynced: Record<string, string> = {};
  for (const id of monitored) {
    if (firstSynced[id]) nextFirstSynced[id] = firstSynced[id];
  }

  const { error: updateErr } = await supabase
    .from("connected_accounts")
    .update({
      slack_monitored_channels: monitored,
      raw_provider_data: {
        ...rawProvider,
        slack_channel_first_synced: nextFirstSynced,
      },
    })
    .eq("id", connectionId);
  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, monitored });
}
