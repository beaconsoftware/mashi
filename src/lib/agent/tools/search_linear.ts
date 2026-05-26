import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";

const args = z.object({
  query: z.string().optional(),
  status: z.string().optional(),
  priority: z.number().int().optional(),
  assignee_email: z.string().optional(),
  company_id: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

type Args = z.infer<typeof args>;

export const search_linear: ToolDefinition<Args, unknown> = {
  name: "search_linear",
  description:
    "Search Linear issues by query, status, priority, assignee_email, or company. Default sort: last_synced_at DESC. Default limit 30, max 100.",
  ring: "read",
  args,
  handler: async (input, ctx) => {
    const limit = Math.min(Math.max(input.limit ?? 30, 1), 100);
    let q = ctx.supabase
      .from("linear_issues")
      .select(
        "id, external_id, title, description, status, priority, assignee_name, assignee_email, labels, due_date, url, company_id, last_synced_at"
      )
      .eq("user_id", ctx.userId)
      .order("last_synced_at", { ascending: false })
      .limit(limit);

    if (input.query) {
      const safe = input.query.replace(/[%_]/g, "");
      q = q.or(`title.ilike.%${safe}%,description.ilike.%${safe}%`);
    }
    if (input.status) q = q.eq("status", input.status);
    if (typeof input.priority === "number") q = q.eq("priority", input.priority);
    if (input.assignee_email) q = q.eq("assignee_email", input.assignee_email);
    if (input.company_id) q = q.eq("company_id", input.company_id);

    const { data, error } = await q;
    if (error) throw error;
    return { issues: data ?? [], count: data?.length ?? 0 };
  },
};
