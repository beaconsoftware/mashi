import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";
import { getActiveAccessToken } from "@/lib/oauth/flow";

const args = z.object({
  to: z.string().min(3),
  subject: z.string().min(1).max(998),
  body: z.string().min(1).max(50_000),
  in_reply_to: z.string().optional(),
});

type Args = z.infer<typeof args>;

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";

/**
 * Ring-3 draft_email — creates a Gmail draft (does NOT send). The user
 * still has to approve the call before the draft hits their account.
 * Useful when the agent wants to leave a starting point for later
 * editing in Gmail itself.
 */
export const draft_email: ToolDefinition<
  Args,
  { ok: boolean; draft_id?: string; error?: string }
> = {
  name: "draft_email",
  description:
    "Create a Gmail draft (does NOT send). Pause-and-approve: the call surfaces the approval card; the draft is created only after the user clicks Approve. Lands in the user's Gmail drafts folder.\n\nUse when: the user wants something staged for review in Gmail rather than dispatched immediately, or the copy still needs iteration. Example: { to: 'maya@portco.com', subject: 'Re: Q4 brand spend', body: 'Draft…' }.\n\nDo NOT use when the user has already approved sending — call send_email. Do NOT use to read a thread (call get_message_thread). Pull the user's voice with get_style before composing.\n\nReturns: { ok, draft_id } on success; { ok: false, error } when no Gmail account is connected or Gmail rejects the draft.",
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
    if (!conn) return { ok: false, error: "No Gmail account connected." };
    const token = await getActiveAccessToken(conn.id);

    let inReplyToHeader = "";
    let referencesHeader = "";
    let gmailThreadId: string | undefined;
    if (input.in_reply_to) {
      const { data: msg } = await ctx.supabase
        .from("messages")
        .select("external_id, thread_id")
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
          // Soft failure
        }
      }
    }

    const newReferences = [referencesHeader, inReplyToHeader]
      .filter(Boolean)
      .join(" ")
      .trim();
    const raw = composeRawMime({
      from: conn.account_email ?? "",
      to: input.to,
      subject: input.subject,
      body: input.body,
      inReplyTo: inReplyToHeader || undefined,
      references: newReferences || undefined,
    });

    const res = await fetch(`${GMAIL_API}/users/me/drafts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          raw,
          ...(gmailThreadId ? { threadId: gmailThreadId } : {}),
        },
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        error: `Gmail draft failed: ${res.status} ${text.slice(0, 200)}`,
      };
    }
    const j = (await res.json()) as { id?: string };
    return { ok: true, draft_id: j.id };
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
  return Buffer.from(lines.join("\r\n"), "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function encodeHeader(s: string): string {
  if (/^[\x00-\x7F]*$/.test(s)) return s;
  return `=?UTF-8?B?${Buffer.from(s, "utf-8").toString("base64")}?=`;
}
