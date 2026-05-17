import { mcpTool } from "@/lib/mcp/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Args {
  /** UUID. Either this or ticket_number. */
  id?: string;
  /** Integer like 237 (for MASH-237). */
  ticket_number?: number;
}

export const POST = mcpTool<Args, unknown>(async (args, ctx) => {
  let q = ctx.supabase
    .from("s2d_items")
    .select("*")
    .eq("user_id", ctx.userId)
    .limit(1);
  if (args.id) q = q.eq("id", args.id);
  else if (typeof args.ticket_number === "number") q = q.eq("ticket_number", args.ticket_number);
  else throw new Error("Provide either `id` or `ticket_number`.");

  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  if (!data) return { item: null };

  // Pull company name + linked sources for context
  let companyName: string | null = null;
  if (data.company_id) {
    const { data: c } = await ctx.supabase
      .from("companies")
      .select("name")
      .eq("user_id", ctx.userId)
      .eq("id", data.company_id)
      .maybeSingle();
    companyName = c?.name ?? null;
  }

  return { item: { ...data, company_name: companyName } };
});
