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
    "Archive a Gmail message by removing the INBOX label. Requires user approval.",
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
