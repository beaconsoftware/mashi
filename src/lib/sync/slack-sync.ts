import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getActiveAccessToken } from "@/lib/oauth/flow";
import { runTriageOnUnit, loadExistingForUnit } from "@/lib/triage/orchestrator";
import { parallelMap } from "@/lib/utils/parallel";
import { reconcileMessageReplies } from "@/lib/triage/reconcile";
import { recordSyncFailure, formatSyncError } from "@/lib/oauth/reauth";

const SLACK_API = "https://slack.com/api";
const INITIAL_LOOKBACK_DAYS = 7;
const TOTAL_MESSAGE_CAP = 2000;

/**
 * Slack's `oldest` parameter is a unix-seconds timestamp. First sync uses
 * 7 days back; subsequent syncs use last_synced_at minus a 1-hour overlap
 * buffer so a sync mid-conversation doesn't miss the messages that arrived
 * during the previous run.
 */
function slackOldestTs(lastSyncedAt: string | null): string {
  if (!lastSyncedAt) {
    return ((Date.now() - INITIAL_LOOKBACK_DAYS * 86_400_000) / 1000).toString();
  }
  const ageMs = Date.now() - new Date(lastSyncedAt).getTime();
  // Stale → re-fetch the 7-day baseline
  if (ageMs > 7 * 86_400_000) {
    return ((Date.now() - INITIAL_LOOKBACK_DAYS * 86_400_000) / 1000).toString();
  }
  const ts = new Date(lastSyncedAt).getTime() - 3600_000; // 1h buffer
  return (ts / 1000).toString();
}

interface SlackConversation {
  id: string;
  user?: string;
  is_im?: boolean;
  is_mpim?: boolean;
  name?: string;
}

interface SlackMessage {
  ts: string;
  user?: string;
  text?: string;
  subtype?: string;
  thread_ts?: string;
  bot_id?: string;
}

interface SlackUser {
  id: string;
  name?: string;
  real_name?: string;
  profile?: {
    real_name?: string;
    display_name?: string;
    email?: string;
  };
}

interface SliceForTriage {
  conversation_id: string;
  conversation_label: string;
  date: string;
  participants: string[];
  messages: Array<{
    from: string;
    received: string;
    text: string;
    is_from_me: boolean;
  }>;
}

/**
 * Slack sync — v1 (daily-slice Sonnet triage)
 *
 * 1. List DMs + group DMs the user is in
 * 2. Pull last 7 days of messages per conversation
 * 3. Store raw messages in `messages` table
 * 4. Group messages by (conversation_id, YYYY-MM-DD) into "slices"
 * 5. For each slice that has new activity from someone OTHER than the user,
 *    run the triage agent — it sees the whole day's back-and-forth plus
 *    existing open S2D items for that slice
 */
export async function syncSlackConnection(connectionId: string): Promise<{
  conversations: number;
  fetched: number;
  stored: number;
  slicesTriaged: number;
  created: number;
  updated: number;
  closed: number;
}> {
  const supabase = createSupabaseServiceClient();

  const { data: conn, error } = await supabase
    .from("connected_accounts")
    .select("id, user_id, company_id, account_label, last_synced_at")
    .eq("id", connectionId)
    .single();
  if (error) throw error;

  await supabase
    .from("connected_accounts")
    .update({ last_sync_status: "syncing", last_sync_error: null })
    .eq("id", connectionId);

  try {
    const token = await getActiveAccessToken(connectionId);
    const me = await authTest(token);
    const conversations = await listConversations(token);

    const oldestTs = slackOldestTs(conn.last_synced_at);

    // Fetch messages per conversation (keep both my messages AND others' —
    // triage needs full back-and-forth context)
    type Pulled = { message: SlackMessage; conv: SlackConversation };
    const pulled: Pulled[] = [];
    for (const conv of conversations) {
      if (pulled.length >= TOTAL_MESSAGE_CAP) break;
      const msgs = await fetchHistory(token, conv.id, oldestTs);
      for (const m of msgs) {
        if (pulled.length >= TOTAL_MESSAGE_CAP) break;
        if (!isUsefulMessage(m)) continue;
        pulled.push({ message: m, conv });
      }
    }

    if (pulled.length === 0) {
      await markSyncSuccess(supabase, connectionId);
      return {
        conversations: conversations.length,
        fetched: 0,
        stored: 0,
        slicesTriaged: 0,
        created: 0,
        updated: 0,
        closed: 0,
      };
    }

    // Hydrate user names
    const userIds = [
      ...new Set(pulled.map((p) => p.message.user).filter(Boolean) as string[]),
    ];
    const userMap = await loadUsers(token, userIds);

    const userLabel = (uid?: string) => {
      if (!uid) return "unknown";
      const u = userMap.get(uid);
      return u?.profile?.display_name || u?.real_name || u?.name || uid;
    };

    const convLabel = (conv: SlackConversation): string => {
      if (conv.is_im && conv.user) return `DM with ${userLabel(conv.user)}`;
      if (conv.is_mpim) return `Group DM (${conv.name ?? conv.id})`;
      return conv.name ?? conv.id;
    };

    // Persist raw messages
    const messageRows = pulled.map((p) => ({
      external_id: `slack:${conn.id}:${p.message.ts}`,
      thread_id: p.message.thread_ts ?? p.message.ts,
      source: "slack" as const,
      user_id: conn.user_id,
      company_id: conn.company_id,
      connected_account_id: conn.id,
      channel: convLabel(p.conv),
      sender_name: userLabel(p.message.user),
      sender_email: userMap.get(p.message.user ?? "")?.profile?.email ?? null,
      preview: (p.message.text ?? "").slice(0, 240),
      received_at: new Date(parseFloat(p.message.ts) * 1000).toISOString(),
    }));
    const { error: upErr } = await supabase
      .from("messages")
      .upsert(messageRows, { onConflict: "user_id,external_id" });
    if (upErr) throw upErr;

    // Group into daily slices per conversation
    const slices = groupIntoDailySlices(pulled, me.user_id, userLabel, convLabel);

    const triageResults = await parallelMap(slices, 8, async (slice) => {
      try {
        if (slice.messages.every((m) => m.is_from_me)) return null;
        const source_thread_id = `${slice.conversation_id}:${slice.date}`;
        const existing_items = await loadExistingForUnit("slack", source_thread_id);
        return await runTriageOnUnit({
          userId: conn.user_id,
          connectedAccountId: conn.id,
          unit: {
            source_type: "slack",
            source_thread_id,
            source_label: `Slack · ${slice.conversation_label} · ${slice.date} · ${conn.account_label}`,
            company_id: conn.company_id,
            content: slice,
            existing_items,
          },
        });
      } catch (err) {
        console.warn(`[slack-sync] slice triage failed:`, err);
        return null;
      }
    });

    const created = triageResults.reduce((s, r) => s + (r?.created ?? 0), 0);
    const updated = triageResults.reduce((s, r) => s + (r?.updated ?? 0), 0);
    const closed = triageResults.reduce((s, r) => s + (r?.closed ?? 0), 0);

    // Auto-close items where the user has replied in the conversation
    let autoClosed = 0;
    try {
      const r = await reconcileMessageReplies("slack", conn.user_id);
      autoClosed = r.closed;
    } catch (err) {
      console.warn("[slack-sync] reconcile failed:", err);
    }

    await markSyncSuccess(supabase, connectionId);

    return {
      conversations: conversations.length,
      fetched: pulled.length,
      stored: messageRows.length,
      slicesTriaged: slices.length,
      created,
      updated,
      closed: closed + autoClosed,
    };
  } catch (err) {
    const msg = formatSyncError(err, "Slack");
    console.error("[sync] Slack failed", { connectionId, err, msg });
    await recordSyncFailure(connectionId, msg);
    throw err;
  }
}

/**
 * Bucket messages by (conversation, calendar-day) into triage units.
 * Each slice carries the full back-and-forth from that day in that DM.
 */
function groupIntoDailySlices(
  pulled: Array<{ message: SlackMessage; conv: SlackConversation }>,
  myUserId: string,
  userLabel: (uid?: string) => string,
  convLabel: (c: SlackConversation) => string
): SliceForTriage[] {
  const buckets = new Map<
    string,
    { conv: SlackConversation; date: string; messages: SlackMessage[] }
  >();

  for (const { message, conv } of pulled) {
    const dateKey = isoDay(parseFloat(message.ts) * 1000);
    const key = `${conv.id}::${dateKey}`;
    if (!buckets.has(key)) {
      buckets.set(key, { conv, date: dateKey, messages: [] });
    }
    buckets.get(key)!.messages.push(message);
  }

  const out: SliceForTriage[] = [];
  for (const bucket of buckets.values()) {
    const sortedMsgs = [...bucket.messages].sort(
      (a, b) => parseFloat(a.ts) - parseFloat(b.ts)
    );
    const participants = [
      ...new Set(sortedMsgs.map((m) => userLabel(m.user)).filter(Boolean)),
    ];
    out.push({
      conversation_id: bucket.conv.id,
      conversation_label: convLabel(bucket.conv),
      date: bucket.date,
      participants,
      messages: sortedMsgs.map((m) => ({
        from: userLabel(m.user),
        received: new Date(parseFloat(m.ts) * 1000).toISOString(),
        text: (m.text ?? "").slice(0, 800),
        is_from_me: m.user === myUserId,
      })),
    });
  }
  return out;
}

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

// ============================================================================
// Slack API helpers (unchanged from v0)
// ============================================================================

async function slackGet<T>(
  token: string,
  method: string,
  params: Record<string, string>
): Promise<T> {
  const url = new URL(`${SLACK_API}/${method}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const j = (await res.json()) as T & { ok?: boolean; error?: string };
  if (!j.ok) throw new Error(`Slack ${method} failed: ${j.error ?? res.status}`);
  return j;
}

async function authTest(token: string): Promise<{ user_id: string; user: string }> {
  return slackGet<{ user_id: string; user: string }>(token, "auth.test", {});
}

async function listConversations(token: string): Promise<SlackConversation[]> {
  const out: SlackConversation[] = [];
  let cursor: string | undefined;
  do {
    const params: Record<string, string> = {
      types: "im,mpim",
      limit: "200",
      exclude_archived: "true",
    };
    if (cursor) params.cursor = cursor;
    const j = await slackGet<{
      channels: SlackConversation[];
      response_metadata?: { next_cursor?: string };
    }>(token, "conversations.list", params);
    out.push(...j.channels);
    cursor = j.response_metadata?.next_cursor || undefined;
  } while (cursor);
  return out;
}

async function fetchHistory(
  token: string,
  channelId: string,
  oldestTs: string
): Promise<SlackMessage[]> {
  const out: SlackMessage[] = [];
  let cursor: string | undefined;
  do {
    const params: Record<string, string> = {
      channel: channelId,
      oldest: oldestTs,
      limit: "200",
    };
    if (cursor) params.cursor = cursor;
    try {
      const j = await slackGet<{
        messages: SlackMessage[];
        response_metadata?: { next_cursor?: string };
      }>(token, "conversations.history", params);
      out.push(...j.messages);
      cursor = j.response_metadata?.next_cursor || undefined;
    } catch (err) {
      console.warn(`[slack-sync] history failed for ${channelId}:`, err);
      break;
    }
  } while (cursor);
  return out;
}

async function loadUsers(
  token: string,
  ids: string[]
): Promise<Map<string, SlackUser>> {
  const map = new Map<string, SlackUser>();
  let cursor: string | undefined;
  const wanted = new Set(ids);
  do {
    const params: Record<string, string> = { limit: "1000" };
    if (cursor) params.cursor = cursor;
    try {
      const j = await slackGet<{
        members: SlackUser[];
        response_metadata?: { next_cursor?: string };
      }>(token, "users.list", params);
      for (const u of j.members) if (wanted.has(u.id)) map.set(u.id, u);
      cursor = j.response_metadata?.next_cursor || undefined;
      if (map.size >= wanted.size) break;
    } catch (err) {
      console.warn("[slack-sync] users.list failed:", err);
      break;
    }
  } while (cursor);
  return map;
}

function isUsefulMessage(m: SlackMessage): boolean {
  if (!m.text || m.text.trim().length === 0) return false;
  if (m.bot_id) return false;
  if (m.subtype && m.subtype !== "thread_broadcast" && m.subtype !== "file_share") {
    return false;
  }
  if (m.thread_ts && m.thread_ts !== m.ts) return false;
  return true;
}

async function markSyncSuccess(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  connectionId: string
) {
  await supabase
    .from("connected_accounts")
    .update({
      last_sync_status: "success",
      last_sync_error: null,
      last_synced_at: new Date().toISOString(),
    })
    .eq("id", connectionId);
}
