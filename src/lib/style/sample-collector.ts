import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getActiveAccessToken } from "@/lib/oauth/flow";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";
const SLACK_API = "https://slack.com/api";

/**
 * Pull representative writing samples from the user's actual Gmail (sent) and
 * Slack (their own messages) for style-profile extraction.
 *
 * Strategy:
 *   - Gmail: per connected account, `q=in:sent newer_than:30d` → fetch bodies
 *   - Slack: per workspace, list DMs → conversations.history → keep only
 *     messages authored by the user
 *   - Filter out auto-replies, calendar invites, very short messages, links-only
 *   - Sample to a target count
 *
 * We do NOT persist these samples — they're transient inputs to the
 * extraction agent. Tokens stay encrypted, raw text never leaves memory.
 */
export interface RichSample {
  channel: "gmail" | "slack";
  account_label: string;
  to: string | null;        // recipient email (gmail) or DM channel id (slack)
  subject: string | null;   // gmail only
  body: string;             // already trimmed/quoted-reply-stripped, capped ~800 chars
  sent_at: string;          // ISO
}

export interface SampleCollectResult {
  /** Plain strings for the style-extractor prompt (back-compat). */
  samples: string[];
  /** Same data, structured. Use for MCP / per-recipient filtering. */
  rich_samples: RichSample[];
  perSource: { gmail: number; slack: number };
  perAccount: Array<{ provider: string; account_label: string; count: number }>;
}

export async function collectWritingSamples(opts: {
  userId: string;
  target?: number;
  /** If set, narrow Gmail `in:sent` query to `to:<email>` so samples
   *  reflect how the user writes to this specific person. Slack DM
   *  lookup is attempted by resolving the email → Slack user id. */
  recipientEmail?: string;
  /** Restrict to one channel only. Default: both. */
  channel?: "gmail" | "slack";
}): Promise<SampleCollectResult> {
  const target = opts.target ?? 25;
  const supabase = createSupabaseServiceClient();

  const providerFilter: Array<"gmail" | "slack"> = opts.channel
    ? [opts.channel]
    : ["gmail", "slack"];

  const { data: connections } = await supabase
    .from("connected_accounts")
    .select("id, provider, account_email, account_label")
    .eq("user_id", opts.userId)
    .in("provider", providerFilter);

  const collected: RichSample[] = [];
  const perAccount: Array<{ provider: string; account_label: string; count: number }> = [];

  // Per-account share so a single inbox doesn't dominate the final batch.
  const perAccountTarget = Math.max(5, Math.ceil(target / Math.max(1, (connections ?? []).length)));

  for (const c of connections ?? []) {
    try {
      let samples: RichSample[] = [];
      if (c.provider === "gmail") {
        samples = await collectGmailSent(c.id, c.account_label, perAccountTarget, {
          recipientEmail: opts.recipientEmail,
        });
      } else if (c.provider === "slack") {
        samples = await collectSlackOwnMessages(
          c.id,
          c.account_label,
          c.account_email ?? "",
          perAccountTarget,
          { recipientEmail: opts.recipientEmail }
        );
      }
      collected.push(...samples);
      perAccount.push({
        provider: c.provider,
        account_label: c.account_label,
        count: samples.length,
      });
    } catch (err) {
      console.warn(`[style-collector] ${c.provider}/${c.id} failed:`, err);
    }
  }

  // Deduplicate roughly-identical bodies (auto-reply boilerplate slips through)
  const seen = new Set<string>();
  const unique: RichSample[] = [];
  for (const s of collected) {
    const key = s.body.slice(0, 80).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(s);
    if (unique.length >= target) break;
  }

  return {
    samples: unique.map((s) => s.body),
    rich_samples: unique,
    perSource: {
      gmail: collected.filter((c) => c.channel === "gmail").length,
      slack: collected.filter((c) => c.channel === "slack").length,
    },
    perAccount,
  };
}

// =========================================================================
// Gmail: sent messages
// =========================================================================

async function collectGmailSent(
  connectionId: string,
  accountLabel: string,
  target: number,
  opts: { recipientEmail?: string } = {}
): Promise<RichSample[]> {
  const token = await getActiveAccessToken(connectionId);
  const url = new URL(`${GMAIL_API}/users/me/messages`);
  const qParts = ["in:sent", "newer_than:60d", "-from:noreply", "-from:no-reply"];
  if (opts.recipientEmail) {
    qParts.push(`to:${opts.recipientEmail}`);
  } else {
    qParts.push("newer_than:30d");
  }
  url.searchParams.set("q", qParts.join(" "));
  url.searchParams.set("maxResults", String(Math.min(target * 3, 60)));

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Gmail sent list failed: ${res.status}`);
  const j = (await res.json()) as { messages?: Array<{ id: string }> };
  const ids = (j.messages ?? []).map((m) => m.id);

  // Hydrate full bodies in parallel
  const hydrated = await Promise.all(
    ids.map(async (id): Promise<RichSample | null> => {
      try {
        const u = new URL(`${GMAIL_API}/users/me/messages/${id}`);
        u.searchParams.set("format", "full");
        const r = await fetch(u, { headers: { Authorization: `Bearer ${token}` } });
        if (!r.ok) return null;
        const m = (await r.json()) as GmailFullMessage;
        const text = extractPlainText(m.payload);
        const subject = headerValue(m.payload?.headers, "Subject");
        const toHeader = headerValue(m.payload?.headers, "To") ?? "";
        const dateHeader = headerValue(m.payload?.headers, "Date");
        const body = trimQuotedReplyTail(composeGmailSample(subject ?? "", text));
        if (!isLikelyHumanProse(body)) return null;
        return {
          channel: "gmail" as const,
          account_label: accountLabel,
          to: extractFirstEmail(toHeader),
          subject: subject ?? null,
          body,
          sent_at: dateHeader ? new Date(dateHeader).toISOString() : new Date().toISOString(),
        };
      } catch {
        return null;
      }
    })
  );

  return hydrated.filter((s): s is RichSample => s != null).slice(0, target);
}

function extractFirstEmail(header: string): string | null {
  const m = header.match(/<([^>]+)>/);
  if (m) return m[1].toLowerCase();
  const bare = header.trim().match(/^[^\s,]+@[^\s,]+$/);
  return bare ? bare[0].toLowerCase() : null;
}

interface GmailFullMessage {
  payload?: {
    headers?: Array<{ name: string; value: string }>;
    body?: { data?: string };
    mimeType?: string;
    parts?: Array<{
      mimeType?: string;
      body?: { data?: string };
      parts?: Array<{ mimeType?: string; body?: { data?: string } }>;
    }>;
  };
}

function headerValue(
  headers: Array<{ name: string; value: string }> | undefined,
  name: string
): string | null {
  return (
    headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? null
  );
}

function extractPlainText(payload: GmailFullMessage["payload"] | undefined): string {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  const parts = payload.parts ?? [];
  for (const p of parts) {
    if (p.mimeType === "text/plain" && p.body?.data) {
      return decodeBase64Url(p.body.data);
    }
  }
  for (const p of parts) {
    if (p.mimeType === "text/html" && p.body?.data) {
      return stripHtml(decodeBase64Url(p.body.data));
    }
  }
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

function composeGmailSample(subject: string, body: string): string {
  // For style purposes we want just the body — subject is context but doesn't
  // reflect prose style. Keep the body, cap at ~600 chars.
  return body.slice(0, 800);
}

/**
 * Drop the quoted-reply tail ("On Tue, May 12, X wrote: > ...") so we keep
 * only what the user actually wrote.
 */
function trimQuotedReplyTail(text: string): string {
  const splits = [
    /^On .{1,80}wrote:[\s\S]*/m,
    /^From: .{1,200}Sent: [\s\S]*/m,
    /^-{2,}\s*Original Message\s*-{2,}[\s\S]*/im,
    /^>+ .*/m,
  ];
  let out = text;
  for (const re of splits) {
    const m = out.match(re);
    if (m && m.index != null) {
      out = out.slice(0, m.index).trim();
    }
  }
  return out;
}

// =========================================================================
// Slack: messages authored by the user in DMs
// =========================================================================

async function collectSlackOwnMessages(
  connectionId: string,
  accountLabel: string,
  _accountEmail: string,
  target: number,
  opts: { recipientEmail?: string } = {}
): Promise<RichSample[]> {
  const token = await getActiveAccessToken(connectionId);

  // Who am I in this workspace?
  const authRes = await fetch(`${SLACK_API}/auth.test`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const auth = (await authRes.json()) as { ok: boolean; user_id?: string };
  if (!auth.ok || !auth.user_id) return [];
  const myUserId = auth.user_id;

  // If a recipient email was provided, try to resolve them to a Slack user
  // and restrict DMs to that conversation only. Best-effort — if lookup
  // fails we just return [] (better than the wrong person's samples).
  let recipientUserId: string | null = null;
  if (opts.recipientEmail) {
    try {
      const lookupRes = await fetch(
        `${SLACK_API}/users.lookupByEmail?email=${encodeURIComponent(opts.recipientEmail)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const lookup = (await lookupRes.json()) as {
        ok: boolean;
        user?: { id: string };
      };
      if (lookup.ok && lookup.user) recipientUserId = lookup.user.id;
      else return [];
    } catch {
      return [];
    }
  }

  // List DMs (im) — most likely to contain free-form prose
  const convRes = await fetch(`${SLACK_API}/conversations.list?types=im&limit=200`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const conv = (await convRes.json()) as {
    ok: boolean;
    channels?: Array<{ id: string; user?: string }>;
  };
  if (!conv.ok) return [];

  const channels = recipientUserId
    ? (conv.channels ?? []).filter((c) => c.user === recipientUserId)
    : (conv.channels ?? []);

  const oldestTs = ((Date.now() - 60 * 86_400_000) / 1000).toString();
  const samples: RichSample[] = [];

  for (const c of channels) {
    if (samples.length >= target) break;
    try {
      const url = new URL(`${SLACK_API}/conversations.history`);
      url.searchParams.set("channel", c.id);
      url.searchParams.set("oldest", oldestTs);
      url.searchParams.set("limit", "100");
      const r = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const j = (await r.json()) as {
        ok: boolean;
        messages?: Array<{
          user?: string;
          text?: string;
          subtype?: string;
          ts: string;
        }>;
      };
      if (!j.ok) continue;
      for (const m of j.messages ?? []) {
        if (m.user !== myUserId) continue;
        if (m.subtype) continue;
        const text = (m.text ?? "").trim();
        if (!isLikelyHumanProse(text)) continue;
        samples.push({
          channel: "slack" as const,
          account_label: accountLabel,
          to: c.id,
          subject: null,
          body: text.slice(0, 800),
          sent_at: new Date(parseFloat(m.ts) * 1000).toISOString(),
        });
        if (samples.length >= target) break;
      }
    } catch (err) {
      console.warn(`[style-collector] slack history failed:`, err);
    }
  }
  return samples;
}

// =========================================================================
// Filters
// =========================================================================

function isLikelyHumanProse(text: string): boolean {
  const t = (text ?? "").trim();
  if (t.length < 40) return false; // too short to show style
  if (t.length > 2000) return false; // huge dumps tend to be quoted content
  // Mostly-URL? Skip.
  const urls = t.match(/https?:\/\//g)?.length ?? 0;
  if (urls > 0 && t.replace(/https?:\/\/\S+/g, "").trim().length < 40) return false;
  // Auto-reply / OOO patterns
  const autoSignals = [
    /out of (the )?office/i,
    /automatic reply/i,
    /will respond when/i,
    /thanks for your email,? i/i,
    /unsubscribe/i,
    /this email was sent/i,
  ];
  if (autoSignals.some((re) => re.test(t))) return false;
  return true;
}
