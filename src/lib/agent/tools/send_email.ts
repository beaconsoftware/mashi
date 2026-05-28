import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";
import { getActiveAccessToken } from "@/lib/oauth/flow";

const args = z.object({
  to: z.string().min(3).describe("Recipient email address."),
  subject: z.string().min(1).max(998),
  body: z.string().min(1).max(50_000),
  in_reply_to: z
    .string()
    .optional()
    .describe(
      "Optional Gmail message external_id (from messages.external_id) to thread the reply under."
    ),
  channel: z.literal("gmail").default("gmail"),
});

type Args = z.infer<typeof args>;

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";

/**
 * Ring-3 send_email — fires a Gmail message after the user approves
 * the call from the inline approval card. Resolves the user's active
 * Gmail connected_account. If `in_reply_to` references an indexed
 * message we own, we'll thread under that message's Gmail threadId
 * and inherit Message-ID + References for clean threading.
 */
export const send_email: ToolDefinition<
  Args,
  {
    ok: boolean;
    message_id?: string;
    thread_id?: string;
    sent_to?: string;
    error?: string;
  }
> = {
  name: "send_email",
  description:
    "Send an email through the user's connected Gmail account. Pause-and-approve: the call surfaces the approval card; the actual send fires only after the user clicks Approve. Pass in_reply_to (message external_id from search_messages / get_message_thread) for clean threading.\n\nUse when: the user has signed off on the actual send ('send it', 'reply to Maya with this'). Brief the user on the recipient + subject + first line before calling. Example: { to: 'maya@portco.com', subject: 'Re: Q4 brand spend', body: 'Hi Maya, here\\u0027s the revised proposal…', in_reply_to: 'ABC123…' }.\n\nDo NOT use to draft something for later review — call draft_email so it lands as a Gmail draft instead. Do NOT use to read a thread (call get_message_thread). Pull the user's voice with get_style before composing.\n\nReturns: { ok, message_id, thread_id, sent_to } on success; { ok: false, error } when no Gmail account is connected or Gmail rejects the send.",
  ring: "write_world",
  args,
  handler: async (input, ctx) => {
    const { data: conn } = await ctx.supabase
      .from("connected_accounts")
      .select("id, account_email")
      .eq("user_id", ctx.userId)
      .eq("provider", "gmail")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!conn) {
      return { ok: false, error: "No Gmail account connected." };
    }
    const token = await getActiveAccessToken(conn.id);

    let inReplyToHeader = "";
    let referencesHeader = "";
    let gmailThreadId: string | undefined;
    if (input.in_reply_to) {
      const { data: msg } = await ctx.supabase
        .from("messages")
        .select("external_id, thread_id, subject, sender_email")
        .eq("user_id", ctx.userId)
        .eq("source", "gmail")
        .eq("external_id", input.in_reply_to)
        .maybeSingle();
      if (msg) {
        gmailThreadId = msg.thread_id ?? undefined;
        try {
          const url = new URL(
            `${GMAIL_API}/users/me/messages/${msg.external_id}`
          );
          url.searchParams.set("format", "metadata");
          for (const h of ["Message-ID", "References"]) {
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
              (j.payload?.headers ?? []).map((h) => [
                h.name.toLowerCase(),
                h.value,
              ])
            );
            inReplyToHeader = headers.get("message-id") ?? "";
            referencesHeader = headers.get("references") ?? "";
          }
        } catch {
          // Soft failure — we'll send as a fresh thread.
        }
      }
    }

    const subject = input.subject;
    const newReferences = [referencesHeader, inReplyToHeader]
      .filter(Boolean)
      .join(" ")
      .trim();

    const raw = composeRawMime({
      from: conn.account_email ?? "",
      to: input.to,
      subject,
      body: input.body,
      inReplyTo: inReplyToHeader || undefined,
      references: newReferences || undefined,
    });

    const sendRes = await fetch(`${GMAIL_API}/users/me/messages/send`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        raw,
        ...(gmailThreadId ? { threadId: gmailThreadId } : {}),
      }),
    });
    if (!sendRes.ok) {
      const text = await sendRes.text().catch(() => "");
      return {
        ok: false,
        error: `Gmail send failed: ${sendRes.status} ${text.slice(0, 200)}`,
      };
    }
    const j = (await sendRes.json()) as { id?: string; threadId?: string };
    return {
      ok: true,
      message_id: j.id,
      thread_id: j.threadId,
      sent_to: input.to,
    };
  },
};

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
  return Buffer.from(message, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function encodeHeader(s: string): string {
  if (/^[\x00-\x7F]*$/.test(s)) return s;
  const b64 = Buffer.from(s, "utf-8").toString("base64");
  return `=?UTF-8?B?${b64}?=`;
}
