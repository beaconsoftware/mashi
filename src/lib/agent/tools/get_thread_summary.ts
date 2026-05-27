import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";

const args = z.object({
  thread_id: z.string().uuid(),
});

type Args = z.infer<typeof args>;

/**
 * Returns the agent-written rolling summary of an `agent_threads` row.
 * Phase 6 introduces the compaction generator that writes
 * `agent_threads.summary`; for now this tool exposes whatever has been
 * written so the agent can lean on it without re-reading every message.
 *
 * Returns null when the thread doesn't exist or has no summary yet
 * (e.g. fresh threads still under the ~8k-token compaction threshold).
 */
export const get_thread_summary: ToolDefinition<Args, unknown> = {
  name: "get_thread_summary",
  description:
    "Returns the rolling agent-written summary of an agent_threads row. Null when the thread doesn't exist or no summary has been generated yet.",
  ring: "read",
  args,
  handler: async (input, ctx) => {
    const { data, error } = await ctx.supabase
      .from("agent_threads")
      .select("id, item_id, title, summary, last_message_at, created_at")
      .eq("user_id", ctx.userId)
      .eq("id", input.thread_id)
      .maybeSingle();
    if (error) throw error;
    return { thread: data ?? null };
  },
};
