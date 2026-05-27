import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";
import { getActiveAccessToken } from "@/lib/oauth/flow";

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
  { ok: boolean; ts?: string; channel?: string; error?: string }
> = {
  name: "send_slack_message",
  description:
    "Post a message to Slack as the connected user. Requires approval. Pass in_reply_to_ts to thread the message under an existing post.",
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
    return { ok: true, ts: j.ts, channel: j.channel };
  },
};
