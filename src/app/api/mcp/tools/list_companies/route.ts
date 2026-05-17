import { mcpTool } from "@/lib/mcp/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = mcpTool<Record<string, never>, unknown>(async (_args, ctx) => {
  const { data, error } = await ctx.supabase
    .from("companies")
    .select("id, name, color_hex, status, email_domain")
    .eq("user_id", ctx.userId)
    .order("name");
  if (error) throw error;
  return { companies: data ?? [] };
});
