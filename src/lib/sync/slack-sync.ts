import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getActiveAccessToken } from "@/lib/oauth/flow";
import { runTriageOnUnit, loadExistingForUnit } from "@/lib/triage/orchestrator";
import { parallelMap } from "@/lib/utils/parallel";
import { reconcileMessageReplies } from "@/lib/triage/reconcile";
import { recordSyncFailure, formatSyncError } from "@/lib/oauth/reauth";
import { emitCloudHeartbeats } from "@/lib/activity/cloud-feeder";
import type { HeartbeatEvent } from "@/lib/activity/types";

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
  is_channel?: boolean;
  is_private?: boolean;
  is_member?: boolean;
  is_archived?: boolean;
  name?: string;
}

interface SlackMessage {
  ts: string;
  user?: string;
  text?: string;
  subtype?: string;
  thread_ts?: string;
  bot_id?: string;
  reply_count?: number;
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
    .select(
      "id, user_id, company_id, account_label, last_synced_at, slack_monitored_channels, raw_provider_data"
    )
    .eq("id", connectionId)
    .single();
  if (error) throw error;

  const monitoredChannelIds = new Set<string>(
    Array.isArray(conn.slack_monitored_channels)
      ? (conn.slack_monitored_channels as unknown[]).filter(
          (v): v is string => typeof v === "string"
        )
      : []
  );
  // Per-channel first-synced-at map. New monitored channels get a 7-day
  // bootstrap window (relative to NOW, not last_synced_at) so the user
  // doesn't have to wait a full sync cycle to see history land.
  const rawProvider = (conn.raw_provider_data ?? {}) as Record<string, unknown>;
  const channelFirstSynced =
    (rawProvider.slack_channel_first_synced as Record<string, string>) ?? {};

  await supabase
    .from("connected_accounts")
    .update({ last_sync_status: "syncing", last_sync_error: null })
    .eq("id", connectionId);

  try {
    const token = await getActiveAccessToken(connectionId);
    const me = await authTest(token);
    const dmAndMpim = await listConversations(token);
    // Resolve monitored public/private channels via conversations.info —
    // cheaper than listing every channel in the workspace, since the user
    // has explicitly opted into a handful.
    const monitoredChannels = await fetchMonitoredChannels(
      token,
      Array.from(monitoredChannelIds)
    );
    const conversations: SlackConversation[] = [...dmAndMpim, ...monitoredChannels];

    const defaultOldestTs = slackOldestTs(conn.last_synced_at);
    const bootstrapOldestTs = (
      (Date.now() - INITIAL_LOOKBACK_DAYS * 86_400_000) /
      1000
    ).toString();
    // Track which monitored channels are getting their first sync, so we
    // can stamp first_synced_at on raw_provider_data after the run
    // completes. (If we stamp before sync and the run fails, the next
    // sync skips the bootstrap and misses the 7-day window.)
    const channelsBootstrappedThisRun: string[] = [];

    // Fetch messages per conversation (keep both my messages AND others' —
    // triage needs full back-and-forth context)
    type Pulled = { message: SlackMessage; conv: SlackConversation };
    const pulled: Pulled[] = [];
    for (const conv of conversations) {
      if (pulled.length >= TOTAL_MESSAGE_CAP) break;
      const isChannel = !conv.is_im && !conv.is_mpim;
      // Channels newly added to the monitored list get a 7-day bootstrap
      // window the first time they're synced — without this, a brand-new
      // monitored channel would only see messages from after the moment
      // you added it (last_synced_at - 1h).
      let oldest = defaultOldestTs;
      if (isChannel && !channelFirstSynced[conv.id]) {
        oldest = bootstrapOldestTs;
        channelsBootstrappedThisRun.push(conv.id);
      }
      const msgs = await fetchHistory(token, conv.id, oldest);
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
      const label = u?.profile?.display_name || u?.real_name || u?.name;
      if (label) return label;
      // Slack Connect / external-workspace users sometimes can't be
      // resolved via users.list OR users.info (the latter sees more but
      // not always). Prefer a friendly placeholder over leaking the
      // raw uid into card titles (e.g. "Sort logins for U095S48SFLL").
      // The participant list and slice text both flow through this
      // function before going to the triage LLM.
      return "external user";
    };

    const convLabel = (conv: SlackConversation): string => {
      if (conv.is_im && conv.user) return `DM with ${userLabel(conv.user)}`;
      if (conv.is_mpim) return `Group DM (${conv.name ?? conv.id})`;
      // Public / private channel name — prefix with # for visual parity
      // with Slack's own UI.
      const name = conv.name ?? conv.id;
      return name.startsWith("#") ? name : `#${name}`;
    };

    // Persist raw messages. Dedup by external_id first — a thread_broadcast
    // (or any reply Slack returns from both conversations.history and
    // conversations.replies) can otherwise appear twice in `pulled`. Postgres
    // rejects an upsert that proposes the same constrained value twice in one
    // statement with SQLSTATE 21000 ("ON CONFLICT DO UPDATE command cannot
    // affect row a second time").
    const seenExternalIds = new Set<string>();
    const messageRows: Array<{
      external_id: string;
      thread_id: string;
      source: "slack";
      user_id: string;
      company_id: string | null;
      connected_account_id: string;
      channel: string;
      sender_name: string;
      sender_email: string | null;
      preview: string;
      received_at: string;
    }> = [];
    for (const p of pulled) {
      const external_id = `slack:${conn.id}:${p.message.ts}`;
      if (seenExternalIds.has(external_id)) continue;
      seenExternalIds.add(external_id);
      messageRows.push({
        external_id,
        thread_id: p.message.thread_ts ?? p.message.ts,
        source: "slack",
        user_id: conn.user_id,
        company_id: conn.company_id,
        connected_account_id: conn.id,
        channel: convLabel(p.conv),
        sender_name: userLabel(p.message.user),
        sender_email: userMap.get(p.message.user ?? "")?.profile?.email ?? null,
        preview: humanizeMentions(p.message.text ?? "", userLabel).slice(0, 240),
        received_at: new Date(parseFloat(p.message.ts) * 1000).toISOString(),
      });
    }
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
        const existing_items = await loadExistingForUnit("slack", source_thread_id, conn.user_id);
        return await runTriageOnUnit({
          userId: conn.user_id,
          connectedAccountId: conn.id,
          unit: {
            source_type: "slack",
            source_thread_id,
            source_label: `Slack · ${slice.conversation_label} · ${slice.date} · ${conn.account_label}`,
            // Slack channel redirect — opens the channel in the user's
            // logged-in workspace. Doesn't deep-link to the specific
            // message (we'd need workspace + ts for a permalink, and
            // we don't capture that yet) but it's the best single-click
            // option for a slack day-slice.
            source_url: `https://slack.com/app_redirect?channel=${encodeURIComponent(slice.conversation_id)}`,
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

    // Cloud feeder — emit `focus` heartbeats for channels where the
    // user sent a message in this sync window. Signals active
    // engagement; matcher proposes `in_progress` for matched S2D
    // items. Opt-in gated; no-op if the watcher isn't enabled.
    try {
      const focusEvents = buildSlackFocusEvents({
        pulled,
        myUserId: me.user_id,
        convLabel,
      });
      if (focusEvents.length > 0) {
        await emitCloudHeartbeats({ userId: conn.user_id, events: focusEvents });
      }
    } catch (err) {
      console.warn("[slack-sync] activity heartbeat emit failed:", err);
    }

    // Auto-close items where the user has replied in the conversation
    let autoClosed = 0;
    try {
      const r = await reconcileMessageReplies("slack", conn.user_id);
      autoClosed = r.closed;
    } catch (err) {
      console.warn("[slack-sync] reconcile failed:", err);
    }

    // Stamp first_synced_at for any channel that just had its bootstrap
    // run. Doing this AFTER markSyncSuccess would race if markSyncSuccess
    // ever pre-computes raw_provider_data; doing it before is safe
    // because we're merging into the existing JSON blob.
    if (channelsBootstrappedThisRun.length > 0) {
      const nowIso = new Date().toISOString();
      const nextStamps: Record<string, string> = { ...channelFirstSynced };
      for (const id of channelsBootstrappedThisRun) nextStamps[id] = nowIso;
      await supabase
        .from("connected_accounts")
        .update({
          raw_provider_data: {
            ...rawProvider,
            slack_channel_first_synced: nextStamps,
          },
        })
        .eq("id", connectionId);
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
        text: humanizeMentions(m.text ?? "", userLabel).slice(0, 800),
        is_from_me: m.user === myUserId,
      })),
    });
  }
  return out;
}

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Slack message text comes with inline ID tokens — `<@U12345>` for user
 * mentions, `<#C12345|channel>` for channel refs, `<!here>` / `<!channel>`
 * / `<!everyone>` for broadcasts. The LLM that generates s2d_item titles
 * happily copies those tokens verbatim, so a card ends up reading
 * "U12345 is blocked..." instead of "Sidd is blocked...".
 *
 * Substitute every recognized token with its human label before the slice
 * goes to triage. New cards land clean; pre-existing items keep their raw
 * IDs (backfill is a separate ask).
 */
function humanizeMentions(text: string, userLabel: (uid?: string) => string): string {
  return text
    .replace(/<@(U[A-Z0-9]+)(?:\|[^>]+)?>/g, (_m, uid) => `@${userLabel(uid)}`)
    .replace(/<#C[A-Z0-9]+\|([^>]+)>/g, (_m, name) => `#${name}`)
    .replace(/<#(C[A-Z0-9]+)>/g, (_m, cid) => `#${cid}`)
    .replace(/<!subteam\^[A-Z0-9]+\|([^>]+)>/g, (_m, name) => name)
    .replace(/<!(here|channel|everyone)>/g, (_m, w) => `@${w}`);
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

/**
 * Resolve a list of channel IDs into SlackConversation objects via
 * conversations.info. Cheaper than listing the workspace's full channel
 * directory when the user has only opted into a handful. Failed lookups
 * (channel deleted, bot kicked, etc.) are silently dropped — sync of
 * everything else should still proceed.
 */
async function fetchMonitoredChannels(
  token: string,
  channelIds: string[]
): Promise<SlackConversation[]> {
  if (channelIds.length === 0) return [];
  const out: SlackConversation[] = [];
  for (const id of channelIds) {
    try {
      const j = await slackGet<{ channel?: SlackConversation }>(
        token,
        "conversations.info",
        { channel: id }
      );
      if (j.channel && !j.channel.is_archived) out.push(j.channel);
    } catch (err) {
      console.warn(`[slack-sync] conversations.info failed for ${id}:`, err);
    }
  }
  return out;
}

async function fetchHistory(
  token: string,
  channelId: string,
  oldestTs: string
): Promise<SlackMessage[]> {
  // Top-level messages first. Slack's conversations.history does NOT
  // include thread replies — those are fetched separately per thread
  // root via conversations.replies (see below).
  const topLevel: SlackMessage[] = [];
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
      topLevel.push(...j.messages);
      cursor = j.response_metadata?.next_cursor || undefined;
    } catch (err) {
      console.warn(`[slack-sync] history failed for ${channelId}:`, err);
      break;
    }
  } while (cursor);

  // Pull thread replies for any top-level message that's a thread root.
  // A thread root has thread_ts === ts and reply_count > 0. Without
  // this, every message inside a Slack thread was invisible — which
  // means a real category of DM work (someone replying to your earlier
  // ping) silently vanished. The day-slice grouping downstream keeps
  // the triage unit bounded so per-thread fan-out doesn't blow up
  // prompt size.
  const out: SlackMessage[] = [];
  for (const m of topLevel) {
    out.push(m);
    const isThreadRoot = m.thread_ts === m.ts && (m.reply_count ?? 0) > 0;
    if (!isThreadRoot) continue;
    try {
      const replies = await fetchThreadReplies(token, channelId, m.ts, oldestTs);
      // conversations.replies returns the parent again as the first
      // element — skip it to avoid duplicating the message we already
      // appended above.
      for (const r of replies) {
        if (r.ts !== m.ts) out.push(r);
      }
    } catch (err) {
      console.warn(
        `[slack-sync] replies failed for ${channelId} thread ${m.ts}:`,
        err
      );
    }
  }
  return out;
}

async function fetchThreadReplies(
  token: string,
  channelId: string,
  threadTs: string,
  oldestTs: string
): Promise<SlackMessage[]> {
  const out: SlackMessage[] = [];
  let cursor: string | undefined;
  do {
    const params: Record<string, string> = {
      channel: channelId,
      ts: threadTs,
      oldest: oldestTs,
      limit: "200",
    };
    if (cursor) params.cursor = cursor;
    const j = await slackGet<{
      messages: SlackMessage[];
      response_metadata?: { next_cursor?: string };
    }>(token, "conversations.replies", params);
    out.push(...(j.messages ?? []));
    cursor = j.response_metadata?.next_cursor || undefined;
  } while (cursor);
  return out;
}

async function loadUsers(
  token: string,
  ids: string[]
): Promise<Map<string, SlackUser>> {
  const map = new Map<string, SlackUser>();
  const wanted = new Set(ids);

  // First pass: users.list — bulk fetch of workspace members. Fast and
  // covers everyone in the user's own workspace.
  let cursor: string | undefined;
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

  // Second pass: users.info per-uid for anyone still missing. Slack
  // Connect users (from external workspaces in shared channels/DMs)
  // do NOT appear in users.list but ARE resolvable via users.info.
  // Without this fallback, external participants leaked into triage
  // payloads as raw `U095S48SFLL`-shape strings and the s2d title LLM
  // copied them verbatim into card titles ("Sort logins for U095…").
  // One API call per missing user; in practice a slice has a small
  // number of external participants so the cost is negligible.
  const stillMissing = Array.from(wanted).filter((id) => !map.has(id));
  for (const id of stillMissing) {
    try {
      const j = await slackGet<{ user?: SlackUser }>(token, "users.info", {
        user: id,
      });
      if (j.user) map.set(id, j.user);
    } catch (err) {
      // users.info also failed (token scope gap, deleted user, etc.).
      // userLabel falls through to a friendly placeholder so the raw
      // ID never reaches card titles.
      console.warn(`[slack-sync] users.info failed for ${id}:`, err);
    }
  }

  return map;
}

function isUsefulMessage(m: SlackMessage): boolean {
  if (!m.text || m.text.trim().length === 0) return false;
  if (m.bot_id) return false;
  if (m.subtype && m.subtype !== "thread_broadcast" && m.subtype !== "file_share") {
    return false;
  }
  // Previously dropped any message where `thread_ts !== ts` (i.e. any
  // reply inside a thread). That silently lost a real category of work
  // — Slack threads inside DMs are common, and the reply often IS the
  // ask. Threads now included; the day-slice grouping still keeps the
  // unit of triage bounded.
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

// ============================================================================
// Activity watcher — cloud feeder
// ============================================================================

/**
 * Build one `focus` heartbeat per Slack conversation in which the user
 * sent at least one message during this sync window. Active engagement
 * is a "this work is in progress" signal — matcher proposes
 * `in_progress` for matching S2D items still in todo/backlog/in_queue.
 *
 * We dedupe by conversation_id so a chatty day doesn't generate a
 * heartbeat per message; the matcher's 30-min window dedup would also
 * collapse them, but emitting once is cleaner and cheaper.
 */
function buildSlackFocusEvents(opts: {
  pulled: Array<{ message: SlackMessage; conv: SlackConversation }>;
  myUserId: string;
  convLabel: (conv: SlackConversation) => string;
}): HeartbeatEvent[] {
  const { pulled, myUserId, convLabel } = opts;

  // Latest user-sent message per conversation
  const latestByConv = new Map<
    string,
    { conv: SlackConversation; ts: number }
  >();
  for (const p of pulled) {
    if (p.message.user !== myUserId) continue;
    const ts = parseFloat(p.message.ts) * 1000;
    const prior = latestByConv.get(p.conv.id);
    if (!prior || ts > prior.ts) {
      latestByConv.set(p.conv.id, { conv: p.conv, ts });
    }
  }

  const events: HeartbeatEvent[] = [];
  for (const [convId, entry] of latestByConv.entries()) {
    events.push({
      surface: "slack",
      identifier: convId,
      title: convLabel(entry.conv),
      url: `https://slack.com/app_redirect?channel=${encodeURIComponent(convId)}`,
      signal_kind: "focus",
      started_at: new Date(entry.ts).toISOString(),
    });
  }
  return events;
}
