import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";

const pathway = z.enum([
  "quick_reply",
  "drafted_response",
  "meeting_backed",
  "heads_down",
  "decision_gate",
  "delegated",
  "watching",
]);
const priority = z.enum(["urgent", "high", "medium", "low"]);
const status = z.enum(["backlog", "todo", "in_progress", "in_queue", "done"]);

const args = z.object({
  query: z.string().optional(),
  pathway: z.union([pathway, z.array(pathway)]).optional(),
  priority: z.union([priority, z.array(priority)]).optional(),
  status: z.union([status, z.array(status)]).optional(),
  company_id: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

type Args = z.infer<typeof args>;

export const search_board: ToolDefinition<Args, unknown> = {
  name: "search_board",
  description:
    "Search S2D items by query, pathway, priority, status, or company. Default sort: updated_at DESC. Default limit 30, max 100.",
  ring: "read",
  args,
  handler: async (input, ctx) => {
    const limit = Math.min(Math.max(input.limit ?? 30, 1), 100);
    let q = ctx.supabase
      .from("s2d_items")
      .select(
        "id, ticket_number, title, description, status, pathway, priority, est_minutes, queue_reason, source_type, source_label, source_url, company_id, created_at, updated_at, done_at, outcome"
      )
      .eq("user_id", ctx.userId)
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (input.query) {
      const safe = input.query.replace(/[%_]/g, "");
      q = q.or(
        `title.ilike.%${safe}%,description.ilike.%${safe}%,outcome.ilike.%${safe}%`
      );
    }
    if (input.pathway) {
      const arr = Array.isArray(input.pathway) ? input.pathway : [input.pathway];
      q = q.in("pathway", arr);
    }
    if (input.priority) {
      const arr = Array.isArray(input.priority)
        ? input.priority
        : [input.priority];
      q = q.in("priority", arr);
    }
    if (input.status) {
      const arr = Array.isArray(input.status) ? input.status : [input.status];
      q = q.in("status", arr);
    }
    if (input.company_id) q = q.eq("company_id", input.company_id);

    const { data, error } = await q;
    if (error) throw error;
    return { items: data ?? [], count: data?.length ?? 0 };
  },
};
