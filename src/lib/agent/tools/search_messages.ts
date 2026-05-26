import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";

const args = z.object({
  query: z.string().optional(),
  source: z.enum(["gmail", "slack"]).optional(),
  sender_email: z.string().optional(),
  since: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

type Args = z.infer<typeof args>;

export const search_messages: ToolDefinition<Args, unknown> = {
  name: "search_messages",
  description:
    "Search Gmail + Slack messages by query, source, sender, or since-date. Default sort: received_at DESC. Default limit 30, max 100.",
  ring: "read",
  args,
  handler: async (input, ctx) => {
    const limit = Math.min(Math.max(input.limit ?? 30, 1), 100);
    let q = ctx.supabase
      .from("messages")
      .select(
        "id, external_id, thread_id, source, sender_name, sender_email, subject, preview, full_content, received_at, channel"
      )
      .eq("user_id", ctx.userId)
      .order("received_at", { ascending: false })
      .limit(limit);

    if (input.query) {
      const safe = input.query.replace(/[%_]/g, "");
      q = q.or(
        `subject.ilike.%${safe}%,preview.ilike.%${safe}%,full_content.ilike.%${safe}%`
      );
    }
    if (input.source) q = q.eq("source", input.source);
    if (input.sender_email) q = q.eq("sender_email", input.sender_email);
    if (input.since) q = q.gte("received_at", input.since);

    const { data, error } = await q;
    if (error) throw error;
    return { messages: data ?? [], count: data?.length ?? 0 };
  },
};
