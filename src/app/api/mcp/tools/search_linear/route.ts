import { mcpTool } from "@/lib/mcp/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Args {
  query?: string;
  status?: string;
  priority?: number;
  assignee_email?: string;
  company_id?: string;
  limit?: number;
}

export const POST = mcpTool<Args, unknown>(async (args, ctx) => {
  const limit = Math.min(Math.max(args.limit ?? 30, 1), 100);
  let q = ctx.supabase
    .from("linear_issues")
    .select(
      "id, external_id, title, description, status, priority, assignee_name, assignee_email, labels, due_date, url, company_id, last_synced_at"
    )
    .eq("user_id", ctx.userId)
    .order("last_synced_at", { ascending: false })
    .limit(limit);

  if (args.query) {
    const safe = args.query.replace(/[%_]/g, "");
    q = q.or(`title.ilike.%${safe}%,description.ilike.%${safe}%`);
  }
  if (args.status) q = q.eq("status", args.status);
  if (typeof args.priority === "number") q = q.eq("priority", args.priority);
  if (args.assignee_email) q = q.eq("assignee_email", args.assignee_email);
  if (args.company_id) q = q.eq("company_id", args.company_id);

  const { data, error } = await q;
  if (error) throw error;
  return { issues: data ?? [], count: data?.length ?? 0 };
});
