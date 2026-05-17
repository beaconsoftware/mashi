import { mcpTool } from "@/lib/mcp/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Args {
  query?: string;
  company_id?: string;
  /** ISO date string. Default: no lower bound */
  since?: string;
  limit?: number;
}

export const POST = mcpTool<Args, unknown>(async (args, ctx) => {
  const limit = Math.min(Math.max(args.limit ?? 20, 1), 100);
  let q = ctx.supabase
    .from("meetings")
    .select(
      "id, external_id, title, date, duration_minutes, attendees, summary, company_id, action_items_extracted"
    )
    .eq("user_id", ctx.userId)
    .order("date", { ascending: false })
    .limit(limit);

  if (args.query) {
    const safe = args.query.replace(/[%_]/g, "");
    q = q.or(`title.ilike.%${safe}%,summary.ilike.%${safe}%`);
  }
  if (args.company_id) q = q.eq("company_id", args.company_id);
  if (args.since) q = q.gte("date", args.since);

  const { data, error } = await q;
  if (error) throw error;
  return { meetings: data ?? [], count: data?.length ?? 0 };
});
