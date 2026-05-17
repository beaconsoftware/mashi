import { mcpTool } from "@/lib/mcp/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Args {
  source: "gmail" | "slack";
  thread_id: string;
}

export const POST = mcpTool<Args, unknown>(async (args, ctx) => {
  if (!args.source || !args.thread_id) {
    throw new Error("Both `source` and `thread_id` are required.");
  }
  const { data, error } = await ctx.supabase
    .from("messages")
    .select(
      "id, external_id, thread_id, source, sender_name, sender_email, subject, preview, full_content, received_at, channel"
    )
    .eq("user_id", ctx.userId)
    .eq("source", args.source)
    .eq("thread_id", args.thread_id)
    .order("received_at", { ascending: true });
  if (error) throw error;
  return { messages: data ?? [], count: data?.length ?? 0 };
});
