import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";
import { getActiveAccessToken } from "@/lib/oauth/flow";

const args = z.object({
  message_id: z
    .string()
    .min(1)
    .describe("Gmail message external_id (matches messages.external_id)."),
});

type Args = z.infer<typeof args>;

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";

/**
 * Ring-3 mark_email_read — removes the UNREAD label from a Gmail
 * message. Requires user approval because it mutates the user's inbox
 * state in Gmail (other clients see the change).
 */
export const mark_email_read: ToolDefinition<
  Args,
  { ok: boolean; error?: string }
> = {
  name: "mark_email_read",
  description:
    "Mark a Gmail message as read by removing the UNREAD label. Requires user approval.",
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
        body: JSON.stringify({ removeLabelIds: ["UNREAD"] }),
      }
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        error: `Gmail modify failed: ${res.status} ${text.slice(0, 200)}`,
      };
    }
    return { ok: true };
  },
};
