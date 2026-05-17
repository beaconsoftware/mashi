import { mcpTool } from "@/lib/mcp/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Args {
  query: string;
  /** Per-source limit. Default 5, max 20. */
  limit_per_source?: number;
}

/**
 * One-shot search across every source Mashi caches. Returns a single
 * mixed list of hits with a `kind` discriminator so the caller can
 * branch on it. Useful for "tell me everything Mashi knows about X."
 */
export const POST = mcpTool<Args, unknown>(async (args, ctx) => {
  if (!args.query?.trim()) {
    return { results: [], note: "query required" };
  }
  const safe = args.query.replace(/[%_]/g, "");
  const lim = Math.min(Math.max(args.limit_per_source ?? 5, 1), 20);

  const [board, meetings, messages, linear] = await Promise.all([
    ctx.supabase
      .from("s2d_items")
      .select("id, ticket_number, title, pathway, priority, status, updated_at")
      .eq("user_id", ctx.userId)
      .or(`title.ilike.%${safe}%,description.ilike.%${safe}%`)
      .order("updated_at", { ascending: false })
      .limit(lim),
    ctx.supabase
      .from("meetings")
      .select("id, external_id, title, date, summary")
      .eq("user_id", ctx.userId)
      .or(`title.ilike.%${safe}%,summary.ilike.%${safe}%`)
      .order("date", { ascending: false })
      .limit(lim),
    ctx.supabase
      .from("messages")
      .select("id, external_id, source, subject, sender_name, sender_email, preview, received_at")
      .eq("user_id", ctx.userId)
      .or(`subject.ilike.%${safe}%,preview.ilike.%${safe}%,full_content.ilike.%${safe}%`)
      .order("received_at", { ascending: false })
      .limit(lim),
    ctx.supabase
      .from("linear_issues")
      .select("id, external_id, title, status, assignee_name, url")
      .eq("user_id", ctx.userId)
      .or(`title.ilike.%${safe}%,description.ilike.%${safe}%`)
      .limit(lim),
  ]);

  const results: Array<Record<string, unknown>> = [];
  for (const it of board.data ?? []) results.push({ kind: "s2d_item", ...it });
  for (const m of meetings.data ?? []) results.push({ kind: "meeting", ...m });
  for (const msg of messages.data ?? []) results.push({ kind: "message", ...msg });
  for (const li of linear.data ?? []) results.push({ kind: "linear_issue", ...li });

  return { results, counts: {
    s2d_items: board.data?.length ?? 0,
    meetings: meetings.data?.length ?? 0,
    messages: messages.data?.length ?? 0,
    linear_issues: linear.data?.length ?? 0,
  } };
});
