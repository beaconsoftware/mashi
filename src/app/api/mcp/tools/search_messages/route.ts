import { mcpTool } from "@/lib/mcp/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Args {
  query?: string;
  source?: "gmail" | "slack";
  sender_email?: string;
  /** ISO date — only messages received after this */
  since?: string;
  limit?: number;
}

export const POST = mcpTool<Args, unknown>(async (args, ctx) => {
  const limit = Math.min(Math.max(args.limit ?? 30, 1), 100);
  let q = ctx.supabase
    .from("messages")
    .select(
      "id, external_id, thread_id, source, sender_name, sender_email, subject, preview, full_content, received_at, channel"
    )
    .eq("user_id", ctx.userId)
    .order("received_at", { ascending: false })
    .limit(limit);

  if (args.query) {
    const safe = args.query.replace(/[%_]/g, "");
    q = q.or(
      `subject.ilike.%${safe}%,preview.ilike.%${safe}%,full_content.ilike.%${safe}%`
    );
  }
  if (args.source) q = q.eq("source", args.source);
  if (args.sender_email) q = q.eq("sender_email", args.sender_email);
  if (args.since) q = q.gte("received_at", args.since);

  const { data, error } = await q;
  if (error) throw error;
  return { messages: data ?? [], count: data?.length ?? 0 };
});
