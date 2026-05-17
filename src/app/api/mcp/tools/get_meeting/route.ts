import { mcpTool } from "@/lib/mcp/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Args {
  /** Either the DB id (UUID) or the Fireflies external_id */
  id?: string;
  external_id?: string;
}

export const POST = mcpTool<Args, unknown>(async (args, ctx) => {
  let q = ctx.supabase
    .from("meetings")
    .select("*")
    .eq("user_id", ctx.userId)
    .limit(1);
  if (args.id) q = q.eq("id", args.id);
  else if (args.external_id) q = q.eq("external_id", args.external_id);
  else throw new Error("Provide either `id` or `external_id`.");

  const { data: meeting, error } = await q.maybeSingle();
  if (error) throw error;
  if (!meeting) return { meeting: null };

  // Action items from this meeting
  const { data: actionItems } = await ctx.supabase
    .from("action_items")
    .select("id, description, assignee, due_date, status")
    .eq("user_id", ctx.userId)
    .eq("source_meeting_id", meeting.id);

  return { meeting, action_items: actionItems ?? [] };
});
