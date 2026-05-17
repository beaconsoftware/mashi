import { mcpTool } from "@/lib/mcp/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Args {
  /** DB id (UUID) */
  id?: string;
  /** Linear's own UUID for the issue */
  external_id?: string;
  /** Linear URL — extract the external_id from it */
  url?: string;
}

export const POST = mcpTool<Args, unknown>(async (args, ctx) => {
  let q = ctx.supabase
    .from("linear_issues")
    .select("*")
    .eq("user_id", ctx.userId)
    .limit(1);
  if (args.id) q = q.eq("id", args.id);
  else if (args.external_id) q = q.eq("external_id", args.external_id);
  else if (args.url) q = q.eq("url", args.url);
  else throw new Error("Provide `id`, `external_id`, or `url`.");

  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  return { issue: data ?? null };
});
