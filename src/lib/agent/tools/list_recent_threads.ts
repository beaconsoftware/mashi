import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";

const args = z.object({
  since: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(50).optional(),
  include_orphan: z.boolean().optional(),
});

type Args = z.infer<typeof args>;

interface ThreadSummary {
  id: string;
  title: string;
  item_id: string | null;
  ticket_number: number | null;
  last_message_at: string | null;
  created_at: string;
  is_orphan: boolean;
}

/**
 * Recent agent threads for the user — drives the Spotlight history
 * panel and lets the agent surface "what did we decide last week?"
 * style questions to specific threads. Sorted by last_message_at DESC.
 *
 * `include_orphan` defaults to true. When false, only item-bound
 * threads come back (useful when the agent wants to summarize work
 * across items, not Spotlight chatter).
 */
export const list_recent_threads: ToolDefinition<
  Args,
  { threads: ThreadSummary[]; count: number }
> = {
  name: "list_recent_threads",
  description:
    "List the user's recent agent threads (Ask Mashi conversations) newest first. Each row has the thread id, optional item_id binding (null for orphan Spotlight chats), title, and last_message_at.\n\nUse when: the user asks 'what have we been talking about?', 'show me my recent Mashi chats', or you want to surface a relevant prior conversation. Example: { limit: 10, include_orphan: false }.\n\nDo NOT use to fetch a single thread's messages — that's not exposed as a tool, only the rolling summary via get_thread_summary.\n\nReturns: { threads, count }. Empty when the user has no threads yet.",
  ring: "read",
  args,
  handler: async (input, ctx) => {
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
    const includeOrphan = input.include_orphan ?? true;
    let q = ctx.supabase
      .from("agent_threads")
      .select("id, title, item_id, last_message_at, created_at")
      .eq("user_id", ctx.userId)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(limit);
    if (!includeOrphan) q = q.not("item_id", "is", null);
    if (input.since) q = q.gte("last_message_at", input.since);
    const { data, error } = await q;
    if (error) throw error;
    const rows = (data ?? []) as Array<{
      id: string;
      title: string;
      item_id: string | null;
      last_message_at: string | null;
      created_at: string;
    }>;

    // Hydrate ticket numbers for bound threads in a single follow-up
    // query so the Spotlight history can render "MASH-1408, …" labels
    // without a per-thread fetch.
    const boundItemIds = rows
      .map((r) => r.item_id)
      .filter((x): x is string => !!x);
    let ticketByItem = new Map<string, number | null>();
    if (boundItemIds.length > 0) {
      const items = await ctx.supabase
        .from("s2d_items")
        .select("id, ticket_number")
        .eq("user_id", ctx.userId)
        .in("id", boundItemIds);
      const itemRows = (items.data ?? []) as Array<{
        id: string;
        ticket_number: number | null;
      }>;
      ticketByItem = new Map(itemRows.map((r) => [r.id, r.ticket_number]));
    }

    const threads: ThreadSummary[] = rows.map((r) => ({
      id: r.id,
      title: r.title,
      item_id: r.item_id,
      ticket_number: r.item_id ? ticketByItem.get(r.item_id) ?? null : null,
      last_message_at: r.last_message_at,
      created_at: r.created_at,
      is_orphan: r.item_id == null,
    }));
    return { threads, count: threads.length };
  },
};
