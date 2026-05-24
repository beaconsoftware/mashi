import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getActiveAccessToken } from "@/lib/oauth/flow";
import { runTriageOnUnit, loadExistingForUnit } from "@/lib/triage/orchestrator";
import { parallelMap } from "@/lib/utils/parallel";
import { reconcileMessageReplies } from "@/lib/triage/reconcile";
import { recordSyncFailure, formatSyncError } from "@/lib/oauth/reauth";
import { emitCloudHeartbeats } from "@/lib/activity/cloud-feeder";
import type { HeartbeatEvent } from "@/lib/activity/types";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";

// Initial backfill: only on first sync (last_synced_at is null OR > 30 days old)
const INITIAL_SYNC_CAP = 1500;
const BASE_QUERY =
  "in:inbox -category:promotions -category:social -category:updates -category:forums";

/**
 * Build the Gmail search query for this sync. First sync gets 90 days;
 * subsequent syncs only look at messages since the last successful sync
 * (with a 1-day overlap buffer to catch anything that arrived during the
 * previous run).
 */
function buildGmailQuery(lastSyncedAt: string | null): string {
  // First sync OR stale (>30d) → full 90-day backfill
  if (!lastSyncedAt) return `${BASE_QUERY} newer_than:90d`;
  const ageMs = Date.now() - new Date(lastSyncedAt).getTime();
  if (ageMs > 30 * 86_400_000) return `${BASE_QUERY} newer_than:90d`;

  // Otherwise: incremental. Gmail's `after:` takes YYYY/MM/DD. We rewind by
  // 1 day from last sync so a sync that happened mid-day still catches
  // anything older-same-day on the next run.
  const cutoff = new Date(new Date(lastSyncedAt).getTime() - 86_400_000);
  const y = cutoff.getUTCFullYear();
  const m = String(cutoff.getUTCMonth() + 1).padStart(2, "0");
  const d = String(cutoff.getUTCDate()).padStart(2, "0");
  return `${BASE_QUERY} after:${y}/${m}/${d}`;
}

interface GmailListItem {
  id: string;
  threadId: string;
}

interface GmailMessageMeta {
  id: string;
  threadId: string;
  internalDate?: string;
  snippet: string;
  payload?: {
    headers?: Array<{ name: string; value: string }>;
  };
}

interface MessageRow {
  external_id: string;
  thread_id: string;
  source: "gmail";
  user_id: string;
  company_id: string | null;
  connected_account_id: string;
  sender_name: string;
  sender_email: string;
  subject: string;
  preview: string;
  received_at: string;
}

interface ThreadForTriage {
  thread_id: string;
  subject: string;
  participants: string[];
  message_count: number;
  messages: Array<{
    from: string;
    to: string[];
    received: string;
    text: string;
    is_from_me: boolean;
  }>;
}

/**
 * Gmail sync — v1 (thread-level Sonnet triage)
 *
 * Pipeline:
 *   1. List message IDs in last 90 days (excluding noise tabs)
 *   2. Hydrate metadata for ones we don't have yet
 *   3. Filter automated senders
 *   4. Store in `messages` (still useful for the inbox UI later)
 *   5. Group new messages by thread_id; for each touched thread, fetch
 *      the FULL thread context (all messages) and run the triage agent
 *   6. The agent decides creates/updates/closes against the S2D board
 */
export async function syncGmailConnection(connectionId: string): Promise<{
  listed: number;
  stored: number;
  threadsTriaged: number;
  created: number;
  updated: number;
  closed: number;
}> {
  const supabase = createSupabaseServiceClient();

  const { data: conn, error } = await supabase
    .from("connected_accounts")
    .select(
      "id, user_id, company_id, account_email, account_label, last_synced_at"
    )
    .eq("id", connectionId)
    .single();
  if (error) throw error;

  await supabase
    .from("connected_accounts")
    .update({ last_sync_status: "syncing", last_sync_error: null })
    .eq("id", connectionId);

  try {
    const token = await getActiveAccessToken(connectionId);
    const myEmail = (conn.account_email ?? "").toLowerCase();

    // 1) List — incremental window since last sync (full 90d on first run)
    const query = buildGmailQuery(conn.last_synced_at);
    const listed = await listMessageIds(token, query, INITIAL_SYNC_CAP);

    // 2) Skip already-stored
    const known = await loadKnownExternalIds(
      supabase,
      listed.map((m) => m.id)
    );
    const newIds = listed.filter((m) => !known.has(m.id));

    // 3) Hydrate metadata
    const detailed = await hydrateMetadata(token, newIds.map((m) => m.id));

    // 4) Filter automated
    const filtered = detailed.filter(notAutomated);

    if (filtered.length === 0) {
      await markSyncSuccess(supabase, connectionId);
      return {
        listed: listed.length,
        stored: 0,
        threadsTriaged: 0,
        created: 0,
        updated: 0,
        closed: 0,
      };
    }

    // 5) Store messages (no per-message triage anymore — that happens at thread level)
    const messageRows: MessageRow[] = filtered.map((m) => ({
      external_id: m.id,
      thread_id: m.threadId,
      source: "gmail" as const,
      user_id: conn.user_id,
      company_id: conn.company_id,
      connected_account_id: conn.id,
      sender_name: m.from_name,
      sender_email: m.from_email,
      subject: m.subject,
      preview: m.snippet.slice(0, 240),
      received_at: m.received_at,
    }));

    const { error: upErr } = await supabase
      .from("messages")
      .upsert(messageRows, { onConflict: "user_id,external_id" });
    if (upErr) throw upErr;

    // 6) Per-thread triage, parallelized
    const uniqueThreadIds = [...new Set(filtered.map((m) => m.threadId))];

    const triageResults = await parallelMap(uniqueThreadIds, 8, async (threadId) => {
      try {
        const thread = await buildThreadContext(token, threadId, myEmail);
        if (!thread || thread.messages.length === 0) return null;
        if (thread.messages.every((m) => m.is_from_me)) return null;

        const existing_items = await loadExistingForUnit("gmail", threadId);

        return await runTriageOnUnit({
          userId: conn.user_id,
          connectedAccountId: conn.id,
          unit: {
            source_type: "gmail",
            source_thread_id: threadId,
            source_label: `Gmail · ${thread.subject || "(no subject)"} · ${conn.account_label}`,
            // Pre-built thread deep link. deriveSourceUrl can build the
            // same one client-side from just threadId, but populating
            // source_url at create time means the chip is always linked
            // even before any client-side derivation.
            source_url: `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(threadId)}`,
            company_id: conn.company_id,
            content: thread,
            existing_items,
          },
        });
      } catch (err) {
        console.warn(`[gmail-sync] thread ${threadId} triage failed:`, err);
        return null;
      }
    });

    const created = triageResults.reduce((s, r) => s + (r?.created ?? 0), 0);
    const updated = triageResults.reduce((s, r) => s + (r?.updated ?? 0), 0);
    const closed = triageResults.reduce((s, r) => s + (r?.closed ?? 0), 0);

    // Cloud feeder — emit `archive` heartbeats for open S2D gmail items
    // whose thread has dropped out of the inbox. Done BEFORE reconcile
    // so the matcher sees items in their pre-auto-close state. The
    // cloud-feeder is opt-in-gated; no-op if the user hasn't enabled
    // the watcher.
    try {
      await emitGmailActivityHeartbeats({
        userId: conn.user_id,
        connectionToken: token,
        connectionId: conn.id,
        listedThreadIds: new Set(listed.map((m) => m.threadId)),
      });
    } catch (err) {
      console.warn("[gmail-sync] activity heartbeat emit failed:", err);
    }

    // Auto-close items where the user has replied in the thread
    let autoClosed = 0;
    try {
      const r = await reconcileMessageReplies("gmail", conn.user_id);
      autoClosed = r.closed;
    } catch (err) {
      console.warn("[gmail-sync] reconcile failed:", err);
    }

    await markSyncSuccess(supabase, connectionId);

    return {
      listed: listed.length,
      stored: messageRows.length,
      threadsTriaged: uniqueThreadIds.length,
      created,
      updated,
      closed: closed + autoClosed,
    };
  } catch (err) {
    const msg = formatSyncError(err, "Gmail");
    console.error("[sync] Gmail failed", { connectionId, err, msg });
    await recordSyncFailure(connectionId, msg);
    throw err;
  }
}

// ============================================================================
// Gmail API helpers
// ============================================================================

async function listMessageIds(
  token: string,
  query: string,
  cap: number
): Promise<GmailListItem[]> {
  const out: GmailListItem[] = [];
  let pageToken: string | undefined;
  while (out.length < cap) {
    const url = new URL(`${GMAIL_API}/users/me/messages`);
    url.searchParams.set("q", query);
    url.searchParams.set("maxResults", "500");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(`Gmail list failed: ${res.status} ${await res.text()}`);
    }
    const j = (await res.json()) as {
      messages?: GmailListItem[];
      nextPageToken?: string;
    };
    if (j.messages) out.push(...j.messages);
    if (!j.nextPageToken) break;
    pageToken = j.nextPageToken;
  }
  return out.slice(0, cap);
}

async function loadKnownExternalIds(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  ids: string[]
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { data } = await supabase
    .from("messages")
    .select("external_id")
    .in("external_id", ids);
  return new Set((data ?? []).map((r) => r.external_id as string));
}

interface MessageMeta {
  id: string;
  threadId: string;
  snippet: string;
  subject: string;
  from_name: string;
  from_email: string;
  to_emails: string[];
  received_at: string;
}

async function hydrateMetadata(
  token: string,
  ids: string[]
): Promise<MessageMeta[]> {
  const CONCURRENCY = 10;
  const out: MessageMeta[] = [];
  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const slice = ids.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      slice.map((id) => fetchMessageMeta(token, id))
    );
    for (const r of results) {
      if (r.status === "fulfilled" && r.value) out.push(r.value);
    }
  }
  return out;
}

async function fetchMessageMeta(
  token: string,
  id: string
): Promise<MessageMeta | null> {
  const url = new URL(`${GMAIL_API}/users/me/messages/${id}`);
  url.searchParams.set("format", "metadata");
  for (const h of ["Subject", "From", "To", "Cc", "Date"]) {
    url.searchParams.append("metadataHeaders", h);
  }
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const m = (await res.json()) as GmailMessageMeta;

  const headers = new Map(
    (m.payload?.headers ?? []).map((h) => [h.name.toLowerCase(), h.value])
  );
  const subject = headers.get("subject") ?? "";
  const fromRaw = headers.get("from") ?? "";
  const { name: from_name, email: from_email } = parseAddress(fromRaw);
  const to_emails = parseAddresses(headers.get("to") ?? "")
    .concat(parseAddresses(headers.get("cc") ?? ""))
    .map((a) => a.email.toLowerCase());

  const internalMs = m.internalDate ? parseInt(m.internalDate, 10) : Date.now();

  return {
    id: m.id,
    threadId: m.threadId,
    snippet: m.snippet ?? "",
    subject,
    from_name,
    from_email,
    to_emails,
    received_at: new Date(internalMs).toISOString(),
  };
}

interface GmailFullMessage {
  id: string;
  threadId: string;
  internalDate?: string;
  snippet: string;
  payload?: {
    headers?: Array<{ name: string; value: string }>;
    body?: { data?: string };
    mimeType?: string;
    parts?: Array<{
      mimeType?: string;
      body?: { data?: string };
      parts?: Array<{
        mimeType?: string;
        body?: { data?: string };
      }>;
    }>;
  };
}

/**
 * Pull the full thread (all messages) and shape it into triage-agent input.
 * We include enough body to be useful (~600 chars per message) but cap
 * total length so we don't blow token budget on long threads.
 */
async function buildThreadContext(
  token: string,
  threadId: string,
  myEmail: string
): Promise<ThreadForTriage | null> {
  const url = new URL(`${GMAIL_API}/users/me/threads/${threadId}`);
  url.searchParams.set("format", "full");
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const j = (await res.json()) as { messages?: GmailFullMessage[] };
  const msgs = j.messages ?? [];
  if (msgs.length === 0) return null;

  const firstHeaders = new Map(
    (msgs[0]?.payload?.headers ?? []).map((h) => [h.name.toLowerCase(), h.value])
  );
  const subject = firstHeaders.get("subject") ?? "(no subject)";

  // Cap thread to last 12 messages — enough context, bounded token budget.
  const trimmed = msgs.slice(-12);

  const messages = trimmed.map((m) => {
    const headers = new Map(
      (m.payload?.headers ?? []).map((h) => [h.name.toLowerCase(), h.value])
    );
    const fromRaw = headers.get("from") ?? "";
    const toRaw = headers.get("to") ?? "";
    const ccRaw = headers.get("cc") ?? "";
    const from = parseAddress(fromRaw);
    const to = [...parseAddresses(toRaw), ...parseAddresses(ccRaw)].map((a) => a.email);
    const body = extractPlainText(m.payload).slice(0, 600);
    const internalMs = m.internalDate ? parseInt(m.internalDate, 10) : Date.now();
    return {
      from: from.name ? `${from.name} <${from.email}>` : from.email,
      to,
      received: new Date(internalMs).toISOString(),
      text: body || m.snippet,
      is_from_me: from.email === myEmail,
    };
  });

  const participants = [
    ...new Set(
      messages
        .flatMap((m) => [m.from.match(/<(.+)>/)?.[1] ?? m.from, ...m.to])
        .map((e) => e.toLowerCase())
        .filter(Boolean)
    ),
  ];

  return {
    thread_id: threadId,
    subject,
    participants,
    message_count: msgs.length,
    messages,
  };
}

function extractPlainText(
  payload: GmailFullMessage["payload"] | undefined
): string {
  if (!payload) return "";
  // Prefer text/plain at top level
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  // Walk parts
  const parts = payload.parts ?? [];
  for (const p of parts) {
    if (p.mimeType === "text/plain" && p.body?.data) {
      return decodeBase64Url(p.body.data);
    }
  }
  // Fall back to first text/html part stripped of tags
  for (const p of parts) {
    if (p.mimeType === "text/html" && p.body?.data) {
      return stripHtml(decodeBase64Url(p.body.data));
    }
  }
  // Recursive nested
  for (const p of parts) {
    if (p.parts) {
      const nested = extractPlainText({ parts: p.parts });
      if (nested) return nested;
    }
  }
  return "";
}

function decodeBase64Url(b64url: string): string {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  try {
    return Buffer.from(b64, "base64").toString("utf8");
  } catch {
    return "";
  }
}

function stripHtml(s: string): string {
  return s
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseAddress(raw: string): { name: string; email: string } {
  const match = raw.match(/^\s*(?:"?([^"<]*?)"?\s*)?<?([^>]+@[^>]+)>?\s*$/);
  if (!match) return { name: "", email: raw.trim() };
  return { name: (match[1] ?? "").trim(), email: match[2].trim().toLowerCase() };
}

function parseAddresses(raw: string): Array<{ name: string; email: string }> {
  if (!raw) return [];
  return raw.split(",").map(parseAddress).filter((a) => a.email.includes("@"));
}

function notAutomated(m: MessageMeta): boolean {
  const e = m.from_email.toLowerCase();
  if (!e.includes("@")) return false;
  const local = e.split("@")[0];
  const automatedPrefixes = [
    "no-reply",
    "noreply",
    "donotreply",
    "do-not-reply",
    "mailer-daemon",
    "notifications",
    "automated",
    "alerts",
    "support",
    "billing",
    "receipts",
    "info",
    "newsletter",
    "news",
    "marketing",
    "updates",
    "digest",
  ];
  return !automatedPrefixes.some(
    (p) => local === p || local.startsWith(`${p}-`) || local.startsWith(`${p}.`)
  );
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
 * Maximum open Gmail-sourced S2D items we'll probe per sync run for
 * archive state. Bounds API cost — users with hundreds of open items
 * shouldn't blow up the sync. Archives we miss this run will be picked
 * up on subsequent runs since the watcher's matcher only acts on
 * archive events that come in.
 */
const ARCHIVE_PROBE_CAP = 100;

/**
 * Emit `archive` heartbeats for open S2D gmail items whose thread no
 * longer carries the INBOX label.
 *
 * Fast-path: any S2D-tracked thread whose threadId appeared in the
 * current inbox listing is definitionally still in inbox — skip.
 * Slow-path: for items NOT in the listing, query Gmail for the
 * thread's current labels and confirm INBOX is gone.
 *
 * Matcher then turns these into `done` proposals for items currently
 * in `in_progress`.
 */
async function emitGmailActivityHeartbeats(opts: {
  userId: string;
  connectionToken: string;
  connectionId: string;
  listedThreadIds: Set<string>;
}): Promise<void> {
  const { userId, connectionToken, connectionId, listedThreadIds } = opts;
  const supabase = createSupabaseServiceClient();

  // Open S2D items from this user, sourced from gmail and tied to this
  // specific connection (multi-account users: don't probe threads we
  // don't have tokens for in this run).
  const { data: openItems } = await supabase
    .from("s2d_items")
    .select("source_thread_id, title")
    .eq("user_id", userId)
    .eq("source_type", "gmail")
    .neq("status", "done");

  if (!openItems || openItems.length === 0) return;

  // Items whose thread WAS NOT seen in this inbox listing are
  // candidates for "archived". Some will have just been quiet for
  // longer than the listing window — we confirm via thread.get.
  const candidates = openItems
    .filter(
      (r): r is { source_thread_id: string; title: string } =>
        !!r.source_thread_id && !listedThreadIds.has(r.source_thread_id)
    )
    .slice(0, ARCHIVE_PROBE_CAP);

  if (candidates.length === 0) return;

  // Restrict to threads that have at least one message in this
  // connection's messages — otherwise the thread belongs to a different
  // gmail account and we'd burn a token call we'll get a 4xx on.
  const candidateThreadIds = candidates.map((c) => c.source_thread_id);
  const { data: threadRefs } = await supabase
    .from("messages")
    .select("thread_id")
    .eq("user_id", userId)
    .eq("source", "gmail")
    .eq("connected_account_id", connectionId)
    .in("thread_id", candidateThreadIds);
  const probeThreadIds = new Set(
    (threadRefs ?? [])
      .map((r) => r.thread_id)
      .filter((s): s is string => !!s)
  );

  const titleByThreadId = new Map<string, string>();
  for (const c of candidates) titleByThreadId.set(c.source_thread_id, c.title);

  const probeList = candidates.filter((c) =>
    probeThreadIds.has(c.source_thread_id)
  );
  if (probeList.length === 0) return;

  const results = await parallelMap(probeList, 8, async (c) => {
    try {
      const archived = await isThreadArchived(connectionToken, c.source_thread_id);
      return archived ? c.source_thread_id : null;
    } catch (err) {
      console.warn(`[gmail-sync] archive probe failed for ${c.source_thread_id}:`, err);
      return null;
    }
  });

  const archivedIds = results.filter((s): s is string => !!s);
  if (archivedIds.length === 0) return;

  const nowIso = new Date().toISOString();
  const events: HeartbeatEvent[] = archivedIds.map((threadId) => ({
    surface: "gmail",
    identifier: threadId,
    title: titleByThreadId.get(threadId),
    url: `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(threadId)}`,
    signal_kind: "archive",
    // Provider-side archive timestamp isn't exposed by Gmail; use sync
    // time. Still narrower than the matcher's 30min dedup window.
    started_at: nowIso,
  }));

  await emitCloudHeartbeats({ userId, events });
}

/**
 * Check whether a Gmail thread still has the INBOX label. Threads whose
 * messages have ALL been moved out of inbox are "archived" in Gmail
 * parlance. Returns false on any error so we never falsely report an
 * archive.
 */
async function isThreadArchived(
  token: string,
  threadId: string
): Promise<boolean> {
  const url = new URL(`${GMAIL_API}/users/me/threads/${threadId}`);
  url.searchParams.set("format", "minimal");
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return false;
  const j = (await res.json()) as {
    messages?: Array<{ labelIds?: string[] }>;
  };
  const messages = j.messages ?? [];
  if (messages.length === 0) return false;
  // Thread is archived iff NO message still carries INBOX.
  return messages.every((m) => !(m.labelIds ?? []).includes("INBOX"));
}
