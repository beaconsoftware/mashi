import { mcpTool } from "@/lib/mcp/handler";
import type { Pathway, Priority, S2DStatus } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Args {
  query?: string;
  pathway?: Pathway | Pathway[];
  priority?: Priority | Priority[];
  status?: S2DStatus | S2DStatus[];
  company_id?: string;
  /** Default 30, max 100 */
  limit?: number;
}

export const POST = mcpTool<Args, unknown>(async (args, ctx) => {
  const limit = Math.min(Math.max(args.limit ?? 30, 1), 100);
  let q = ctx.supabase
    .from("s2d_items")
    .select(
      "id, ticket_number, title, description, status, pathway, priority, est_minutes, queue_reason, source_type, source_label, source_url, company_id, created_at, updated_at, done_at, outcome"
    )
    .eq("user_id", ctx.userId)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (args.query) {
    const safe = args.query.replace(/[%_]/g, "");
    q = q.or(`title.ilike.%${safe}%,description.ilike.%${safe}%,outcome.ilike.%${safe}%`);
  }
  if (args.pathway) {
    const arr = Array.isArray(args.pathway) ? args.pathway : [args.pathway];
    q = q.in("pathway", arr);
  }
  if (args.priority) {
    const arr = Array.isArray(args.priority) ? args.priority : [args.priority];
    q = q.in("priority", arr);
  }
  if (args.status) {
    const arr = Array.isArray(args.status) ? args.status : [args.status];
    q = q.in("status", arr);
  }
  if (args.company_id) q = q.eq("company_id", args.company_id);

  const { data, error } = await q;
  if (error) throw error;
  return { items: data ?? [], count: data?.length ?? 0 };
});
