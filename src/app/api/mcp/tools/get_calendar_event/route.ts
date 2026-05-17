import { mcpTool } from "@/lib/mcp/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Args {
  id?: string;
  external_id?: string;
}

export const POST = mcpTool<Args, unknown>(async (args, ctx) => {
  let q = ctx.supabase
    .from("calendar_events")
    .select("*")
    .eq("user_id", ctx.userId)
    .limit(1);
  if (args.id) q = q.eq("id", args.id);
  else if (args.external_id) q = q.eq("external_id", args.external_id);
  else throw new Error("Provide `id` or `external_id`.");

  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  return { event: data ?? null };
});
