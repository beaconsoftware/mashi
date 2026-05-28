import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";
import { getActiveAccessToken } from "@/lib/oauth/flow";

const args = z.object({
  message_id: z.string().min(1),
});

type Args = z.infer<typeof args>;

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";

/**
 * Ring-3 archive_email — removes the INBOX label, archiving the
 * message. Requires user approval.
 */
export const archive_email: ToolDefinition<
  Args,
  { ok: boolean; error?: string }
> = {
  name: "archive_email",
  description:
    "Archive a Gmail message by removing the INBOX label. Pause-and-approve: the call surfaces the approval card; the archive fires only after the user clicks Approve. Visible in all Gmail clients.\n\nUse when: the user explicitly asks to archive ('archive that one', 'get rid of this from my inbox'). Example: { message_id: 'ABC123…' } where message_id is the external_id from search_messages.\n\nDo NOT use to mark a message read (call mark_email_read). Do NOT use to read a message body (call get_message_thread). Do NOT bulk-archive in one call — call once per message so the user can approve each.\n\nReturns: { ok } on success; { ok: false, error } when the message isn't found in any connected account or Gmail rejects the modify.",
  ring: "write_world",
  args,
  handler: async (input, ctx) => {
    const { data: msg } = await ctx.supabase
      .from("messages")
      .select("external_id, connected_account_id")
      .eq("user_id", ctx.userId)
      .eq("source", "gmail")
      .eq("external_id", input.message_id)
      .maybeSingle();
    if (!msg?.connected_account_id) {
      return { ok: false, error: "Gmail message not found in this account." };
    }
    const token = await getActiveAccessToken(msg.connected_account_id);
    const res = await fetch(
      `${GMAIL_API}/users/me/messages/${msg.external_id}/modify`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ removeLabelIds: ["INBOX"] }),
      }
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        error: `Gmail archive failed: ${res.status} ${text.slice(0, 200)}`,
      };
    }
    return { ok: true };
  },
};
