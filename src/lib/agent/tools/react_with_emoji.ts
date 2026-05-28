import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";
import { getActiveAccessToken } from "@/lib/oauth/flow";

const args = z.object({
  channel: z.string().min(1),
  ts: z.string().min(1).describe("Slack message ts to react to."),
  emoji: z
    .string()
    .min(1)
    .max(64)
    .describe("Emoji shortname without colons (e.g. 'eyes', 'white_check_mark')."),
});

type Args = z.infer<typeof args>;

const SLACK_API = "https://slack.com/api";

/**
 * Ring-3 react_with_emoji — adds an emoji reaction via reactions.add.
 * Requires user approval (it's visible to everyone in the channel).
 */
export const react_with_emoji: ToolDefinition<
  Args,
  { ok: boolean; error?: string }
> = {
  name: "react_with_emoji",
  description:
    "Add an emoji reaction to a Slack message. Pass the emoji shortname without colons (e.g. 'eyes', 'white_check_mark'). Pause-and-approve: the call surfaces the approval card; the reaction fires only after the user clicks Approve. Visible to everyone in the channel.\n\nUse when: the user explicitly wants to acknowledge a message lightly without typing a reply ('react with 👀 to Maya's post'). Example: { channel: 'C0123456', ts: '1716000000.123456', emoji: 'eyes' }.\n\nDo NOT use to send an actual reply (call send_slack_message). Do NOT use to read a Slack thread (call get_message_thread with source='slack').\n\nReturns: { ok } on success; { ok: false, error } when no Slack account is connected or Slack rejects the reaction.",
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

    const name = input.emoji.replace(/^:|:$/g, "");
    const res = await fetch(`${SLACK_API}/reactions.add`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        channel: input.channel,
        timestamp: input.ts,
        name,
      }),
    });
    const j = (await res.json()) as { ok: boolean; error?: string };
    if (!j.ok) {
      return { ok: false, error: `Slack reaction failed: ${j.error ?? "unknown"}` };
    }
    return { ok: true };
  },
};
