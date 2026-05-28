import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";

const args = z.object({
  query: z.string().min(1, "query required"),
  limit_per_source: z.number().int().min(1).max(20).optional(),
});

type Args = z.infer<typeof args>;

export const search_everything: ToolDefinition<Args, unknown> = {
  name: "search_everything",
  description:
    "Broad fuzzy search across every source in one call: S2D items, Fireflies meetings, Gmail + Slack messages, and Linear issues. Returns a mixed list discriminated by `kind` ('s2d_item' | 'meeting' | 'message' | 'linear_issue').\n\nUse when: the user gives a vague reference and you don't know which surface it lives on — e.g. 'find anything about Project Atlas'. Example: { query: 'Project Atlas' }.\n\nDo NOT use when you already know the source — use the targeted tool (search_board, search_messages, search_meetings, search_linear) for tighter results and a cleaner shape. Do NOT use to resolve a single S2D reference; call resolve_reference.\n\nReturns: { results, counts }. Each result row is `kind`-discriminated. Empty when nothing matches.",
  ring: "read",
  args,
  handler: async (input, ctx) => {
    if (!input.query.trim()) {
      return { results: [], note: "query required" };
    }
    const safe = input.query.replace(/[%_]/g, "");
    const lim = Math.min(Math.max(input.limit_per_source ?? 5, 1), 20);

    const [board, meetings, messages, linear] = await Promise.all([
      ctx.supabase
        .from("s2d_items")
        .select(
          "id, ticket_number, title, pathway, priority, status, updated_at"
        )
        .eq("user_id", ctx.userId)
        .or(`title.ilike.%${safe}%,description.ilike.%${safe}%`)
        .order("updated_at", { ascending: false })
        .limit(lim),
      ctx.supabase
        .from("meetings")
        .select("id, external_id, title, date, summary")
        .eq("user_id", ctx.userId)
        .or(`title.ilike.%${safe}%,summary.ilike.%${safe}%`)
        .order("date", { ascending: false })
        .limit(lim),
      ctx.supabase
        .from("messages")
        .select(
          "id, external_id, source, subject, sender_name, sender_email, preview, received_at"
        )
        .eq("user_id", ctx.userId)
        .or(
          `subject.ilike.%${safe}%,preview.ilike.%${safe}%,full_content.ilike.%${safe}%`
        )
        .order("received_at", { ascending: false })
        .limit(lim),
      ctx.supabase
        .from("linear_issues")
        .select("id, external_id, title, status, assignee_name, url")
        .eq("user_id", ctx.userId)
        .or(`title.ilike.%${safe}%,description.ilike.%${safe}%`)
        .limit(lim),
    ]);

    const results: Array<Record<string, unknown>> = [];
    for (const it of board.data ?? []) results.push({ kind: "s2d_item", ...it });
    for (const m of meetings.data ?? []) results.push({ kind: "meeting", ...m });
    for (const msg of messages.data ?? [])
      results.push({ kind: "message", ...msg });
    for (const li of linear.data ?? [])
      results.push({ kind: "linear_issue", ...li });

    return {
      results,
      counts: {
        s2d_items: board.data?.length ?? 0,
        meetings: meetings.data?.length ?? 0,
        messages: messages.data?.length ?? 0,
        linear_issues: linear.data?.length ?? 0,
      },
    };
  },
};
