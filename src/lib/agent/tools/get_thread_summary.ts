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
    "Return the rolling agent-written summary stored on an agent_threads row. Null when the thread has not yet crossed the compaction threshold or doesn't exist.\n\nUse when: the user references an item with a long prior conversation and you want the gist without replaying every message. Example: { thread_id: '…uuid…' }.\n\nDo NOT use for the current thread's history — the loop already injects it. Do NOT use to read agent_messages directly; that's not exposed as a tool.\n\nReturns: { thread } where thread carries id, item_id, title, summary, last_message_at. thread is null when no row matches.",
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
