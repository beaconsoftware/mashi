import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";
import { getActiveAccessToken } from "@/lib/oauth/flow";
import type { ReverseOp } from "@/lib/agent/undo";

const args = z.object({
  channel: z
    .string()
    .min(1)
    .describe("Slack channel/conversation ID (e.g. C0123456) or DM user ID."),
  body: z.string().min(1).max(40_000),
  in_reply_to_ts: z
    .string()
    .optional()
    .describe(
      "Optional Slack message ts to thread under. Use the parent message's ts."
    ),
});

type Args = z.infer<typeof args>;

const SLACK_API = "https://slack.com/api";

/**
 * Ring-3 send_slack_message — posts to chat.postMessage on the user's
 * primary Slack connection. Requires user approval.
 */
export const send_slack_message: ToolDefinition<
  Args,
  {
    ok: boolean;
    ts?: string;
    channel?: string;
    error?: string;
    /** E4: peeled off before the model sees it; powers the post-send recall
     * strip (chat.delete within the undo window). */
    _undo?: { op: ReverseOp; summary: string };
  }
> = {
  name: "send_slack_message",
  description:
    "Post a message to Slack as the connected user (xoxp- user token, so the post appears under the user's name). Pause-and-approve: the call surfaces the approval card; the send fires only after the user clicks Approve. Pass in_reply_to_ts (parent message ts) to thread under a post.\n\nUse when: the user has signed off on the actual send ('send that on Slack', 'reply in #channel'). Brief them on the channel + first line before calling. Example: { channel: 'C0123456', body: 'Hey team…', in_reply_to_ts: '1716000000.123456' }.\n\nDo NOT use to read a Slack thread (call get_message_thread with source='slack'). Do NOT use to add a reaction (call react_with_emoji). Pull the user's voice with get_style before composing.\n\nReturns: { ok, ts, channel } on success; { ok: false, error } when no Slack account is connected or Slack rejects the post.",
  ring: "write_world",
  args,
  handler: async (input, ctx) => {
    const { data: conn } = await ctx.supabase
      .from("connected_accounts")
      .select("id")
      .eq("user_id", ctx.userId)
      .eq("provider", "slack")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!conn) return { ok: false, error: "No Slack account connected." };
    const token = await getActiveAccessToken(conn.id);

    const payload: Record<string, unknown> = {
      channel: input.channel,
      text: input.body,
    };
    if (input.in_reply_to_ts) payload.thread_ts = input.in_reply_to_ts;

    const res = await fetch(`${SLACK_API}/chat.postMessage`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(payload),
    });
    const j = (await res.json()) as {
      ok: boolean;
      ts?: string;
      channel?: string;
      error?: string;
    };
    if (!j.ok) {
      return { ok: false, error: `Slack send failed: ${j.error ?? "unknown"}` };
    }
    const channel = j.channel ?? input.channel;
    return {
      ok: true,
      ts: j.ts,
      channel,
      ...(j.ts
        ? {
            _undo: {
              op: { kind: "recall_slack_message", channel, ts: j.ts },
              summary: "Message posted to Slack.",
            },
          }
        : {}),
    };
  },
};
