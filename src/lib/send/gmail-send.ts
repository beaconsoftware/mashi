import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getActiveAccessToken } from "@/lib/oauth/flow";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";

interface SendOptions {
  s2dItemId: string;
  body: string;
  /** Override the auto-detected To address (defaults to last sender in thread). */
  toOverride?: string;
  /** Override subject (defaults to "Re: <thread subject>"). */
  subjectOverride?: string;
}

interface SendResult {
  ok: boolean;
  messageId?: string;
  message: string;
}

/**
 * Send a reply through Gmail for an S2D item that originated in a Gmail thread.
 *
 * Resolves the right Gmail connection, picks the most recent message in the
 * thread to inherit headers from, composes a MIME message with In-Reply-To
 * and References, base64-url-encodes it, and POSTs to gmail.users.messages.send.
 *
 * Marks the S2D item as done with outcome=body on success.
 */
export async function sendGmailReply(opts: SendOptions): Promise<SendResult> {
  const supabase = createSupabaseServiceClient();

  // Load the S2D item; bail unless it's Gmail-sourced
  const { data: item } = await supabase
    .from("s2d_items")
    .select("id, source_type, source_thread_id, title")
    .eq("id", opts.s2dItemId)
    .single();
  if (!item || item.source_type !== "gmail" || !item.source_thread_id) {
    return { ok: false, message: "not a Gmail-sourced S2D item" };
  }

  // Find the most recent message in this thread → gives us the right
  // connected_account, plus the headers we need for a clean reply.
  const { data: msgs } = await supabase
    .from("messages")
    .select(
      "external_id, connected_account_id, sender_email, sender_name, subject, received_at"
    )
    .eq("source", "gmail")
    .eq("thread_id", item.source_thread_id)
    .order("received_at", { ascending: false });

  if (!msgs || msgs.length === 0) {
    return { ok: false, message: "no Gmail messages found for thread" };
  }

  // Pick the most recent message NOT from the user's own account as the reply target.
  // Identify "self" by looking at the connection's account_email.
  const connectedAccountId = msgs[0].connected_account_id;
  if (!connectedAccountId) {
    return { ok: false, message: "no connected_account_id on message" };
  }
  const { data: conn } = await supabase
    .from("connected_accounts")
    .select("account_email")
    .eq("id", connectedAccountId)
    .single();
  const myEmail = (conn?.account_email ?? "").toLowerCase();

  const lastFromOther = msgs.find(
    (m) => (m.sender_email ?? "").toLowerCase() !== myEmail
  );
  const target = lastFromOther ?? msgs[0];

  // Pull the latest message's headers from Gmail (Message-ID + References)
  const token = await getActiveAccessToken(connectedAccountId);
  let messageId = "";
  let references = "";
  let toAddress = opts.toOverride ?? target.sender_email ?? "";
  let subject = opts.subjectOverride ?? target.subject ?? item.title;

  try {
    const url = new URL(`${GMAIL_API}/users/me/messages/${target.external_id}`);
    url.searchParams.set("format", "metadata");
    for (const h of ["Message-ID", "References", "Subject", "From"]) {
      url.searchParams.append("metadataHeaders", h);
    }
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (r.ok) {
      const j = (await r.json()) as {
        payload?: { headers?: Array<{ name: string; value: string }> };
      };
      const headers = new Map(
        (j.payload?.headers ?? []).map((h) => [h.name.toLowerCase(), h.value])
      );
      messageId = headers.get("message-id") ?? "";
      references = headers.get("references") ?? "";
      // If we don't have a Subject from our DB row, take it from the live message
      if (!subject) subject = headers.get("subject") ?? item.title;
      // If sender_email is empty, parse from the From header
      if (!toAddress) {
        const from = headers.get("from") ?? "";
        const match = from.match(/<([^>]+)>/);
        toAddress = match?.[1] ?? from;
      }
    }
  } catch {
    // Soft failure — we can still send without thread headers, it'll just be
    // a new top-level message instead of a threaded reply.
  }

  if (!toAddress) {
    return { ok: false, message: "couldn't determine To address" };
  }

  // Ensure subject is "Re: ..." for replies
  if (!/^re:/i.test(subject)) subject = `Re: ${subject}`;

  const newReferences = [references, messageId].filter(Boolean).join(" ").trim();

  const rawMime = composeRawMime({
    from: conn?.account_email ?? "",
    to: toAddress,
    subject,
    body: opts.body,
    inReplyTo: messageId || undefined,
    references: newReferences || undefined,
  });

  // POST to Gmail send
  const sendRes = await fetch(`${GMAIL_API}/users/me/messages/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      raw: rawMime,
      threadId: item.source_thread_id,
    }),
  });

  if (!sendRes.ok) {
    const text = await sendRes.text().catch(() => "");
    return { ok: false, message: `Gmail send failed: ${sendRes.status} ${text}` };
  }

  const sendJson = (await sendRes.json()) as { id?: string };

  // Mark S2D item done
  await supabase
    .from("s2d_items")
    .update({
      status: "done",
      done_at: new Date().toISOString(),
      outcome: opts.body.slice(0, 800),
      resolved_via: "manual",
    })
    .eq("id", item.id);

  return {
    ok: true,
    messageId: sendJson.id,
    message: `Sent to ${toAddress}`,
  };
}

/**
 * Build a base64-url-encoded RFC 5322 message that Gmail's send API accepts.
 * No attachments support; UTF-8 plain text only.
 */
function composeRawMime(opts: {
  from: string;
  to: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
}): string {
  const lines: string[] = [];
  lines.push(`From: ${opts.from}`);
  lines.push(`To: ${opts.to}`);
  lines.push(`Subject: ${encodeHeader(opts.subject)}`);
  if (opts.inReplyTo) lines.push(`In-Reply-To: ${opts.inReplyTo}`);
  if (opts.references) lines.push(`References: ${opts.references}`);
  lines.push("MIME-Version: 1.0");
  lines.push('Content-Type: text/plain; charset="UTF-8"');
  lines.push("Content-Transfer-Encoding: 8bit");
  lines.push("");
  lines.push(opts.body);

  const message = lines.join("\r\n");
  // Gmail expects base64url
  return Buffer.from(message, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Encode subject for non-ASCII content using RFC 2047. Plain ASCII passes
 * through unchanged.
 */
function encodeHeader(s: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(s)) return s;
  const b64 = Buffer.from(s, "utf-8").toString("base64");
  return `=?UTF-8?B?${b64}?=`;
}
