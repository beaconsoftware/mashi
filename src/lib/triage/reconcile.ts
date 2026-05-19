import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getActiveAccessToken } from "@/lib/oauth/flow";
import { propagateClosures } from "./propagate";
import { aiStalenessReview } from "./ai-staleness";

interface ReconcileResult {
  source: "linear" | "gmail" | "slack";
  closed: number;
  closedIds: string[];
  details: string[];
}

/**
 * Per-pathway silence cutoff (in ms). Past this, with no new activity in
 * the underlying thread, the item is presumed dead.
 *
 *   meeting_backed: 7d — prep for a specific meeting; if no one's
 *     emailed in a week, the meeting either happened or got cancelled.
 *   watching: 14d — you were waiting on someone to do something; two
 *     weeks of silence means it didn't happen.
 *   delegated: 21d — keep these around longer; the assignee might just be
 *     working on it without saying anything.
 *   quick_reply / drafted_response: 14d — replies that never went out
 *     after two weeks are usually stale.
 *   everything else: 21d — original default.
 */
function silenceCutoffMs(pathway: string): number {
  const day = 86_400_000;
  switch (pathway) {
    case "meeting_backed":
      return 7 * day;
    case "watching":
    case "quick_reply":
    case "drafted_response":
      return 14 * day;
    case "delegated":
      return 21 * day;
    default:
      return 21 * day;
  }
}

function outcomeForSilence(pathway: string, days: number): string {
  switch (pathway) {
    case "meeting_backed":
      return `Auto-closed: prep task for a meeting whose thread has been quiet ${days} days (meeting presumed past)`;
    case "watching":
      return `Auto-closed: been watching for ${days} days with no movement`;
    case "delegated":
      return `Auto-closed: delegated work, thread silent ${days} days`;
    default:
      return `Auto-closed: thread silent for ${days} days`;
  }
}

// ============================================================================
// Linear — query Linear API directly for current state of every open S2D item
// ============================================================================

const LINEAR_GRAPHQL = "https://api.linear.app/graphql";

export async function reconcileLinearStatuses(userId: string): Promise<ReconcileResult> {
  const supabase = createSupabaseServiceClient();
  const details: string[] = [];
  const closedIds: string[] = [];

  // Open S2D items sourced from Linear — scoped to this user. Service-role
  // bypasses RLS; without the user_id filter we'd close/modify other
  // tenants' Linear-sourced items.
  const { data: items } = await supabase
    .from("s2d_items")
    .select("id, title, source_thread_id")
    .eq("user_id", userId)
    .eq("source_type", "linear")
    .neq("status", "done");

  if (!items || items.length === 0)
    return { source: "linear", closed: 0, closedIds: [], details: [] };

  // We need to know which Linear workspace each issue belongs to so we can use
  // the right OAuth token. linear_issues.connected_account_id has that link.
  const externalIds = items.map((i) => i.source_thread_id).filter((s): s is string => !!s);
  const { data: issueRefs } = await supabase
    .from("linear_issues")
    .select("external_id, connected_account_id")
    .in("external_id", externalIds);

  // Group items by connection
  const byConn = new Map<string, Array<{ id: string; externalId: string; title: string }>>();
  const connByExternal = new Map<string, string>();
  for (const r of issueRefs ?? []) {
    if (r.connected_account_id) connByExternal.set(r.external_id, r.connected_account_id);
  }
  for (const it of items) {
    if (!it.source_thread_id) continue;
    const conn = connByExternal.get(it.source_thread_id);
    if (!conn) continue;
    if (!byConn.has(conn)) byConn.set(conn, []);
    byConn.get(conn)!.push({ id: it.id, externalId: it.source_thread_id, title: it.title });
  }

  // For each connection, batch-query Linear for current state of all our issue IDs
  for (const [connectionId, group] of byConn) {
    try {
      const token = await getActiveAccessToken(connectionId);
      const states = await fetchLinearIssueStates(token, group.map((g) => g.externalId));

      for (const g of group) {
        const state = states.get(g.externalId);
        if (!state) continue;
        if (state.type === "completed" || state.type === "cancelled") {
          await supabase
            .from("s2d_items")
            .update({
              status: "done",
              done_at: new Date().toISOString(),
              outcome: `Resolved in Linear: ${state.name}`,
              resolved_via: "auto_detected",
            })
            .eq("user_id", userId)
            .eq("id", g.id);
          details.push(`${g.title} → ${state.name}`);
          closedIds.push(g.id);
          continue;
        }
        // Stale signal: backlog/unstarted issue not updated in 30+ days
        const ageMs = state.updatedAt ? Date.now() - new Date(state.updatedAt).getTime() : 0;
        const THIRTY_DAYS = 30 * 86_400_000;
        if (
          ageMs > THIRTY_DAYS &&
          (state.type === "backlog" || state.type === "unstarted")
        ) {
          await supabase
            .from("s2d_items")
            .update({
              status: "done",
              done_at: new Date().toISOString(),
              outcome: `Auto-closed: Linear issue stale ${Math.round(ageMs / 86_400_000)} days (${state.name})`,
              resolved_via: "auto_detected",
            })
            .eq("user_id", userId)
            .eq("id", g.id);
          details.push(`${g.title} → stale ${Math.round(ageMs / 86_400_000)}d`);
          closedIds.push(g.id);
        }
      }
    } catch (err) {
      console.warn(`[reconcile-linear] connection ${connectionId} failed:`, err);
    }
  }

  return { source: "linear", closed: details.length, closedIds, details };
}

/**
 * GraphQL: ask Linear for the current state of a set of issues by ID.
 * Linear caps at ~250 nodes per page; we chunk if needed.
 */
async function fetchLinearIssueStates(
  token: string,
  ids: string[]
): Promise<Map<string, { name: string; type: string; updatedAt?: string }>> {
  const result = new Map<string, { name: string; type: string; updatedAt?: string }>();
  const CHUNK = 200;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const query = `
      query IssuesById($ids: [ID!]!) {
        issues(filter: { id: { in: $ids } }, first: ${slice.length}) {
          nodes { id updatedAt state { name type } }
        }
      }
    `;
    const res = await fetch(LINEAR_GRAPHQL, {
      method: "POST",
      headers: {
        Authorization: token, // Linear personal API keys don't take "Bearer"
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables: { ids: slice } }),
    });
    if (!res.ok) continue;
    const j = (await res.json()) as {
      data?: {
        issues?: {
          nodes?: Array<{
            id: string;
            updatedAt: string;
            state: { name: string; type: string };
          }>;
        };
      };
    };
    for (const n of j.data?.issues?.nodes ?? []) {
      result.set(n.id, {
        name: n.state.name,
        type: n.state.type,
        updatedAt: n.updatedAt,
      });
    }
  }
  return result;
}

// ============================================================================
// Gmail — hit the API to check thread latest message; close if I'm the sender
// ============================================================================

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";

export async function reconcileGmailReplies(userId: string): Promise<ReconcileResult> {
  const supabase = createSupabaseServiceClient();
  const details: string[] = [];
  const closedIds: string[] = [];

  // All of THIS USER's open Gmail items. Without the user_id filter,
  // we'd reach across tenants and close another user's items.
  const { data: items } = await supabase
    .from("s2d_items")
    .select("id, title, source_thread_id, pathway, created_at")
    .eq("user_id", userId)
    .eq("source_type", "gmail")
    .neq("status", "done");
  if (!items || items.length === 0)
    return { source: "gmail", closed: 0, closedIds: [], details: [] };

  const threadIds = items.map((i) => i.source_thread_id).filter((s): s is string => !!s);
  const { data: msgs } = await supabase
    .from("messages")
    .select("thread_id, connected_account_id")
    .eq("user_id", userId)
    .eq("source", "gmail")
    .in("thread_id", threadIds);
  const connByThread = new Map<string, string>();
  for (const m of msgs ?? []) {
    if (m.thread_id && m.connected_account_id && !connByThread.has(m.thread_id)) {
      connByThread.set(m.thread_id, m.connected_account_id);
    }
  }

  // For each connected account, get account_email so we can identify "me"
  const accountIds = [...new Set([...connByThread.values()])];
  const { data: accts } = await supabase
    .from("connected_accounts")
    .select("id, account_email")
    .eq("user_id", userId)
    .in("id", accountIds);
  const emailByConn = new Map<string, string>();
  for (const a of accts ?? []) {
    emailByConn.set(a.id, (a.account_email ?? "").toLowerCase());
  }

  // Group items by connection
  const byConn = new Map<string, Array<typeof items[number]>>();
  for (const it of items) {
    if (!it.source_thread_id) continue;
    const conn = connByThread.get(it.source_thread_id);
    if (!conn) continue;
    if (!byConn.has(conn)) byConn.set(conn, []);
    byConn.get(conn)!.push(it);
  }

  for (const [connectionId, group] of byConn) {
    try {
      const token = await getActiveAccessToken(connectionId);
      const myEmail = emailByConn.get(connectionId) ?? "";
      if (!myEmail) continue;

      for (const it of group) {
        if (!it.source_thread_id) continue;
        const latest = await fetchGmailThreadLatest(token, it.source_thread_id);
        if (!latest) continue;
        const senderEmail = latest.fromEmail.toLowerCase();
        const ageMs = Date.now() - latest.timestamp;

        // Signal 1: I replied since the item was created
        if (
          senderEmail === myEmail &&
          latest.timestamp >= new Date(it.created_at).getTime()
        ) {
          await supabase
            .from("s2d_items")
            .update({
              status: "done",
              done_at: new Date().toISOString(),
              outcome: "Auto-closed: you replied in the Gmail thread",
              resolved_via: "auto_detected",
            })
            .eq("user_id", userId)
            .eq("id", it.id);
          details.push(`${it.title} → you replied`);
          closedIds.push(it.id);
          continue;
        }

        // Signal 2: pathway-aware silence cutoff. Prep tasks for meetings
        // go stale fast (the meeting either happened or fell off the
        // calendar); watching items go stale moderately fast (whatever
        // you were waiting for didn't come); everything else gets the
        // default 21-day rule.
        const cutoffMs = silenceCutoffMs(it.pathway);
        if (ageMs > cutoffMs) {
          const days = Math.round(ageMs / 86_400_000);
          await supabase
            .from("s2d_items")
            .update({
              status: "done",
              done_at: new Date().toISOString(),
              outcome: outcomeForSilence(it.pathway, days),
              resolved_via: "auto_detected",
            })
            .eq("user_id", userId)
            .eq("id", it.id);
          details.push(`${it.title} → quiet ${days}d (${it.pathway})`);
          closedIds.push(it.id);
        }
      }
    } catch (err) {
      console.warn(`[reconcile-gmail] connection ${connectionId} failed:`, err);
    }
  }

  return { source: "gmail", closed: details.length, closedIds, details };
}

interface GmailThreadLatest {
  fromEmail: string;
  timestamp: number;
}

async function fetchGmailThreadLatest(
  token: string,
  threadId: string
): Promise<GmailThreadLatest | null> {
  const url = new URL(`${GMAIL_API}/users/me/threads/${threadId}`);
  url.searchParams.set("format", "metadata");
  for (const h of ["From", "Date"]) url.searchParams.append("metadataHeaders", h);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  const j = (await res.json()) as {
    messages?: Array<{
      internalDate?: string;
      payload?: { headers?: Array<{ name: string; value: string }> };
    }>;
  };
  const messages = j.messages ?? [];
  if (messages.length === 0) return null;
  const last = messages[messages.length - 1];
  const headers = new Map(
    (last.payload?.headers ?? []).map((h) => [h.name.toLowerCase(), h.value])
  );
  const from = headers.get("from") ?? "";
  const match = from.match(/<([^>]+)>/);
  const fromEmail = match?.[1] ?? from;
  const timestamp = last.internalDate ? parseInt(last.internalDate, 10) : Date.now();
  return { fromEmail, timestamp };
}

// ============================================================================
// Slack — query conversations.history for the conv_id encoded in source_thread_id
// ============================================================================

const SLACK_API = "https://slack.com/api";

export async function reconcileSlackReplies(userId: string): Promise<ReconcileResult> {
  const supabase = createSupabaseServiceClient();
  const details: string[] = [];
  const closedIds: string[] = [];

  // All of THIS USER's open Slack items.
  const { data: items } = await supabase
    .from("s2d_items")
    .select("id, title, source_thread_id, pathway, created_at")
    .eq("user_id", userId)
    .eq("source_type", "slack")
    .neq("status", "done");
  if (!items || items.length === 0)
    return { source: "slack", closed: 0, closedIds: [], details: [] };

  // This user's Slack connections only.
  const { data: slackConns } = await supabase
    .from("connected_accounts")
    .select("id, account_email")
    .eq("user_id", userId)
    .eq("provider", "slack");
  if (!slackConns || slackConns.length === 0) {
    return { source: "slack", closed: 0, closedIds: [], details: [] };
  }

  // Resolve "me" user_id per connection via auth.test once
  const meByConn = new Map<string, string>();
  for (const c of slackConns) {
    try {
      const token = await getActiveAccessToken(c.id);
      const r = await fetch(`${SLACK_API}/auth.test`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const j = (await r.json()) as { ok: boolean; user_id?: string };
      if (j.ok && j.user_id) meByConn.set(c.id, j.user_id);
    } catch (err) {
      console.warn(`[reconcile-slack] auth.test failed for ${c.id}:`, err);
    }
  }

  for (const it of items) {
    if (!it.source_thread_id) continue;
    const [convId] = it.source_thread_id.split(":");
    if (!convId) continue;

    // For now: try each connection until we get a successful API hit on this conv.
    for (const c of slackConns) {
      try {
        const token = await getActiveAccessToken(c.id);
        const myUserId = meByConn.get(c.id);
        if (!myUserId) continue;

        const url = new URL(`${SLACK_API}/conversations.history`);
        url.searchParams.set("channel", convId);
        url.searchParams.set("limit", "1");
        const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        const j = (await r.json()) as {
          ok: boolean;
          messages?: Array<{ user?: string; ts: string }>;
        };
        if (!j.ok || !j.messages || j.messages.length === 0) continue;
        const last = j.messages[0];
        const ts = parseFloat(last.ts) * 1000;
        const ageMs = Date.now() - ts;

        // Signal 1: you replied since creation
        if (last.user === myUserId && ts >= new Date(it.created_at).getTime()) {
          await supabase
            .from("s2d_items")
            .update({
              status: "done",
              done_at: new Date().toISOString(),
              outcome: "Auto-closed: you replied in the Slack conversation",
              resolved_via: "auto_detected",
            })
            .eq("user_id", userId)
            .eq("id", it.id);
          details.push(`${it.title} → you replied`);
          closedIds.push(it.id);
          break;
        }

        // Signal 2: pathway-aware silence cutoff (same rules as Gmail).
        const cutoffMs = silenceCutoffMs(it.pathway);
        if (ageMs > cutoffMs) {
          const days = Math.round(ageMs / 86_400_000);
          await supabase
            .from("s2d_items")
            .update({
              status: "done",
              done_at: new Date().toISOString(),
              outcome: outcomeForSilence(it.pathway, days),
              resolved_via: "auto_detected",
            })
            .eq("user_id", userId)
            .eq("id", it.id);
          details.push(`${it.title} → quiet ${days}d (${it.pathway})`);
          closedIds.push(it.id);
          break;
        }
        break; // checked this connection, no signal — don't retry on others
      } catch {
        // try next connection
      }
    }
  }

  return { source: "slack", closed: details.length, closedIds, details };
}

/**
 * Backwards-compat wrapper so existing imports in sync routes keep working.
 */
export async function reconcileMessageReplies(
  source: "gmail" | "slack",
  userId: string
): Promise<ReconcileResult> {
  return source === "gmail" ? reconcileGmailReplies(userId) : reconcileSlackReplies(userId);
}

// ============================================================================
// Run all (per user)
// ============================================================================

export async function reconcileAllStatuses(userId: string): Promise<{
  total: number;
  byProvider: ReconcileResult[];
  fireflies: number;
  calendarPast: number;
  stale: number;
  cascaded: number;
}> {
  // Every step is scoped to userId. Service-role bypasses RLS; without
  // scoping, this pass would touch every tenant's items.
  const linear = await reconcileLinearStatuses(userId);
  const gmail = await reconcileGmailReplies(userId);
  const slack = await reconcileSlackReplies(userId);

  let fireflies = { closed: 0, closedIds: [] as string[] };
  try {
    fireflies = await reconcileFirefliesByMeetingAge(30, userId);
  } catch (err) {
    console.warn("[reconcile] fireflies age check failed:", err);
  }

  // Auto-close S2D items whose backing calendar event has already ended.
  // Cheap (single join, no LLM call) so it runs every pass.
  let calendarPast = { closed: 0, closedIds: [] as string[] };
  try {
    calendarPast = await reconcileCalendarPastEvents(userId);
  } catch (err) {
    console.warn("[reconcile] calendar past-event sweep failed:", err);
  }

  let staleResult: { closed: number; closedIds: string[]; details: string[] } = {
    closed: 0,
    closedIds: [],
    details: [],
  };
  try {
    staleResult = await aiStalenessReview(userId);
  } catch (err) {
    console.warn("[reconcile] AI staleness review failed:", err);
  }

  const allClosedIds = [
    ...linear.closedIds,
    ...gmail.closedIds,
    ...slack.closedIds,
    ...fireflies.closedIds,
    ...calendarPast.closedIds,
    ...staleResult.closedIds,
  ];
  let cascaded = 0;
  if (allClosedIds.length > 0) {
    try {
      const r = await propagateClosures(allClosedIds, userId);
      cascaded = r.cascaded;
    } catch (err) {
      console.warn("[reconcile] propagation failed:", err);
    }
  }

  return {
    total:
      linear.closed +
      gmail.closed +
      slack.closed +
      fireflies.closed +
      calendarPast.closed +
      staleResult.closed +
      cascaded,
    byProvider: [linear, gmail, slack],
    fireflies: fireflies.closed,
    calendarPast: calendarPast.closed,
    stale: staleResult.closed,
    cascaded,
  };
}

/**
 * Close Fireflies-sourced S2D items whose underlying meeting happened more
 * than `maxAgeDays` days ago. Action items from old meetings have either
 * been resolved in some other channel or quietly dropped.
 */
/**
 * Close S2D items whose backing calendar event has already ended.
 *
 * The triage prompt guards against CREATING items for past events, but
 * nothing closes an item after time elapses. Result: meeting_backed
 * (and other calendar-sourced) items linger on the board long after
 * the meeting actually happened — e.g., MASH-924 "Victor / Sidd 1:1 —
 * today 4:30pm" sitting in To Do at 9pm.
 *
 * Logic:
 *   - Pull all open S2D items with source_type='calendar' for this user
 *   - Join on calendar_events.external_id = source_thread_id
 *   - For any whose end_at < now(), mark done with a "meeting ended"
 *     outcome and resolved_via='auto_past_meeting'
 *
 * Doesn't touch items whose source_type is gmail/slack but happen to
 * mention a past meeting in the description — those need the ai-staleness
 * text-pattern pass. We only handle the case where Mashi created the
 * item directly from the calendar event, where the linkage is reliable.
 */
export async function reconcileCalendarPastEvents(
  userId: string
): Promise<{ closed: number; closedIds: string[] }> {
  const supabase = createSupabaseServiceClient();
  const closedIds: string[] = [];

  const { data: items } = await supabase
    .from("s2d_items")
    .select("id, title, source_thread_id")
    .eq("user_id", userId)
    .eq("source_type", "calendar")
    .neq("status", "done");
  if (!items || items.length === 0) return { closed: 0, closedIds: [] };

  const externalIds = items
    .map((i) => i.source_thread_id)
    .filter((s): s is string => !!s);
  if (externalIds.length === 0) return { closed: 0, closedIds: [] };

  const { data: events } = await supabase
    .from("calendar_events")
    .select("external_id, end_at, title")
    .eq("user_id", userId)
    .in("external_id", externalIds);

  const endByExternalId = new Map<string, number>();
  for (const e of events ?? []) {
    if (e.end_at) endByExternalId.set(e.external_id, new Date(e.end_at).getTime());
  }

  const nowMs = Date.now();
  for (const it of items) {
    if (!it.source_thread_id) continue;
    const endMs = endByExternalId.get(it.source_thread_id);
    if (endMs == null) continue;
    if (endMs >= nowMs) continue; // event hasn't ended yet

    const minsAgo = Math.round((nowMs - endMs) / 60_000);
    const ageLabel =
      minsAgo < 60
        ? `${minsAgo} min ago`
        : minsAgo < 1440
          ? `${Math.round(minsAgo / 60)}h ago`
          : `${Math.round(minsAgo / 1440)}d ago`;
    const { error } = await supabase
      .from("s2d_items")
      .update({
        status: "done",
        done_at: new Date().toISOString(),
        outcome: `Auto-closed: backing calendar event ended ${ageLabel}`,
        resolved_via: "auto_past_meeting",
      })
      .eq("user_id", userId)
      .eq("id", it.id);
    if (!error) closedIds.push(it.id);
  }

  return { closed: closedIds.length, closedIds };
}

export async function reconcileFirefliesByMeetingAge(
  maxAgeDays: number,
  userId: string
): Promise<{ closed: number; closedIds: string[] }> {
  const supabase = createSupabaseServiceClient();
  const cutoffMs = Date.now() - maxAgeDays * 86_400_000;
  const closedIds: string[] = [];

  const { data: items } = await supabase
    .from("s2d_items")
    .select("id, title, source_thread_id")
    .eq("user_id", userId)
    .eq("source_type", "fireflies")
    .neq("status", "done");
  if (!items || items.length === 0) return { closed: 0, closedIds: [] };

  const externalIds = items.map((i) => i.source_thread_id).filter((s): s is string => !!s);
  if (externalIds.length === 0) return { closed: 0, closedIds: [] };

  const { data: meetings } = await supabase
    .from("meetings")
    .select("external_id, date")
    .eq("user_id", userId)
    .in("external_id", externalIds);

  const dateByExternalId = new Map<string, number>();
  for (const m of meetings ?? []) {
    if (m.date) dateByExternalId.set(m.external_id, new Date(m.date).getTime());
  }

  for (const it of items) {
    if (!it.source_thread_id) continue;
    const ts = dateByExternalId.get(it.source_thread_id);
    if (!ts) continue;
    if (ts < cutoffMs) {
      const ageDays = Math.round((Date.now() - ts) / 86_400_000);
      const { error } = await supabase
        .from("s2d_items")
        .update({
          status: "done",
          done_at: new Date().toISOString(),
          outcome: `Auto-closed: action item from a ${ageDays}-day-old meeting (presumed handled elsewhere or dropped)`,
          resolved_via: "auto_detected",
        })
        .eq("user_id", userId)
        .eq("id", it.id);
      if (!error) closedIds.push(it.id);
    }
  }

  return { closed: closedIds.length, closedIds };
}
