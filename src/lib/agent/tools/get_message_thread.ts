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
    "Fetch every message in one Gmail or Slack thread, oldest first.",
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
