import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";

const args = z.object({
  source: z.enum(["gmail", "slack"]),
  thread_id: z.string().min(1),
});

type Args = z.infer<typeof args>;

export const get_message_thread: ToolDefinition<Args, unknown> = {
  name: "get_message_thread",
  description:
    "Fetch every message in one Gmail or Slack thread, oldest first. Each row includes `full_content` (plain-text body, capped at ~10k chars) plus `preview` (≤240 chars).\n\nUse when: the user asks about message content — what someone said, what they asked for, an amount, a date, a link — read `full_content`, not `preview` (the preview routinely cuts off mid-sentence). Example: { source: 'gmail', thread_id: '198a3c…' }.\n\nDo NOT use to search across threads (call search_messages). Do NOT use to fetch a single message in isolation when the surrounding thread context matters.\n\nReturns: { messages, count }. Empty when no thread matches.",
  ring: "read",
  args,
  handler: async (input, ctx) => {
    const { data, error } = await ctx.supabase
      .from("messages")
      .select(
        "id, external_id, thread_id, source, sender_name, sender_email, subject, preview, full_content, received_at, channel"
      )
      .eq("user_id", ctx.userId)
      .eq("source", input.source)
      .eq("thread_id", input.thread_id)
      .order("received_at", { ascending: true });
    if (error) throw error;
    return { messages: data ?? [], count: data?.length ?? 0 };
  },
};
