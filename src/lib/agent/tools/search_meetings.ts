import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";

const args = z.object({
  query: z.string().optional(),
  company_id: z.string().uuid().optional(),
  since: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

type Args = z.infer<typeof args>;

export const search_meetings: ToolDefinition<Args, unknown> = {
  name: "search_meetings",
  description:
    "Search Fireflies meetings by free-text query, company_id, or a since-date. Default sort: date DESC. Default limit 20, max 100.\n\nUse when: the user asks 'find that meeting with X', 'what meetings did I have with MPP last month?'. Example: { query: 'brand spend', since: '2026-05-01' }.\n\nDo NOT use to fetch a single meeting's details / summary / action items — call get_meeting once you have an id. Do NOT use for calendar events (use get_calendar_event for those).\n\nReturns: { meetings, count }. Each row carries title, date, duration, summary, attendees.",
  ring: "read",
  args,
  handler: async (input, ctx) => {
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
    let q = ctx.supabase
      .from("meetings")
      .select(
        "id, external_id, title, date, duration_minutes, attendees, summary, company_id, action_items_extracted"
      )
      .eq("user_id", ctx.userId)
      .order("date", { ascending: false })
      .limit(limit);

    if (input.query) {
      const safe = input.query.replace(/[%_]/g, "");
      q = q.or(`title.ilike.%${safe}%,summary.ilike.%${safe}%`);
    }
    if (input.company_id) q = q.eq("company_id", input.company_id);
    if (input.since) q = q.gte("date", input.since);

    const { data, error } = await q;
    if (error) throw error;
    return { meetings: data ?? [], count: data?.length ?? 0 };
  },
};
