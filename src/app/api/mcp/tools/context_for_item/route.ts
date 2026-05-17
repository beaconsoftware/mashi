import { mcpTool } from "@/lib/mcp/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Args {
  id?: string;
  ticket_number?: number;
}

interface LinkedSource {
  source_type?: string | null;
  source_thread_id?: string | null;
  source_label?: string | null;
}

/**
 * Pull the full source-side context for an S2D item: every Gmail
 * thread, Slack conversation, Linear issue, Fireflies meeting that's
 * attached. The detail sheet uses this same data.
 *
 * Use when you need to understand "what is MASH-237 actually about,
 * what did people say, what's the history."
 */
export const POST = mcpTool<Args, unknown>(async (args, ctx) => {
  // Resolve the item
  let q = ctx.supabase
    .from("s2d_items")
    .select("*")
    .eq("user_id", ctx.userId)
    .limit(1);
  if (args.id) q = q.eq("id", args.id);
  else if (typeof args.ticket_number === "number") q = q.eq("ticket_number", args.ticket_number);
  else throw new Error("Provide `id` or `ticket_number`.");

  const { data: item, error } = await q.maybeSingle();
  if (error) throw error;
  if (!item) return { item: null, sources: [] };

  // Gather all sources (the primary + every linked_sources entry)
  const sources: Array<{ source_type: string; source_thread_id: string; source_label: string | null }> = [];
  if (item.source_type && item.source_thread_id) {
    sources.push({
      source_type: item.source_type,
      source_thread_id: item.source_thread_id,
      source_label: item.source_label,
    });
  }
  for (const ls of (item.linked_sources ?? []) as LinkedSource[]) {
    if (!ls.source_type || !ls.source_thread_id) continue;
    if (sources.some((s) => s.source_type === ls.source_type && s.source_thread_id === ls.source_thread_id)) continue;
    sources.push({
      source_type: ls.source_type,
      source_thread_id: ls.source_thread_id,
      source_label: ls.source_label ?? null,
    });
  }

  // Hydrate each source
  const hydrated = await Promise.all(
    sources.map(async (s) => {
      if (s.source_type === "gmail" || s.source_type === "slack") {
        const { data } = await ctx.supabase
          .from("messages")
          .select("sender_name, sender_email, subject, preview, full_content, received_at, channel")
          .eq("user_id", ctx.userId)
          .eq("source", s.source_type)
          .eq("thread_id", s.source_thread_id)
          .order("received_at", { ascending: true });
        return { ...s, messages: data ?? [] };
      }
      if (s.source_type === "linear") {
        const { data } = await ctx.supabase
          .from("linear_issues")
          .select("title, status, description, assignee_name, url")
          .eq("user_id", ctx.userId)
          .eq("external_id", s.source_thread_id)
          .maybeSingle();
        return { ...s, issue: data ?? null };
      }
      if (s.source_type === "fireflies") {
        const { data: m } = await ctx.supabase
          .from("meetings")
          .select("id, title, date, summary, attendees")
          .eq("user_id", ctx.userId)
          .eq("external_id", s.source_thread_id)
          .maybeSingle();
        let actionItems: unknown[] = [];
        if (m?.id) {
          const { data: ai } = await ctx.supabase
            .from("action_items")
            .select("description, assignee, status")
            .eq("user_id", ctx.userId)
            .eq("source_meeting_id", m.id);
          actionItems = ai ?? [];
        }
        return { ...s, meeting: m ?? null, action_items: actionItems };
      }
      if (s.source_type === "calendar") {
        const { data } = await ctx.supabase
          .from("calendar_events")
          .select("title, description, start_at, end_at, attendees, location, meeting_url")
          .eq("user_id", ctx.userId)
          .eq("external_id", s.source_thread_id)
          .maybeSingle();
        return { ...s, event: data ?? null };
      }
      return { ...s, raw: null };
    })
  );

  return { item, sources: hydrated };
});
