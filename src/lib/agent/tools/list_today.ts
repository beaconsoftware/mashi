import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";

const args = z.object({}).optional().default({});

type Args = z.infer<typeof args>;

export const list_today: ToolDefinition<Args, unknown> = {
  name: "list_today",
  description:
    "One-call orientation. Returns today's calendar events, urgent/high open items, items scheduled for today, and items resurfacing from snooze.",
  ring: "read",
  args,
  handler: async (_input, ctx) => {
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);
    const todayIso = startOfDay.toISOString().slice(0, 10);

    const [calendar, urgent, sprint, resurfacing] = await Promise.all([
      ctx.supabase
        .from("calendar_events")
        .select(
          "id, title, start_at, end_at, attendees, location, meeting_url, description"
        )
        .eq("user_id", ctx.userId)
        .gte("start_at", startOfDay.toISOString())
        .lt("start_at", endOfDay.toISOString())
        .order("start_at"),
      ctx.supabase
        .from("s2d_items")
        .select(
          "id, ticket_number, title, pathway, priority, status, queue_reason, est_minutes, company_id"
        )
        .eq("user_id", ctx.userId)
        .in("priority", ["urgent", "high"])
        .neq("status", "done")
        .order("priority")
        .order("updated_at", { ascending: false })
        .limit(20),
      ctx.supabase
        .from("s2d_items")
        .select(
          "id, ticket_number, title, pathway, priority, status, est_minutes, sprint_start_at"
        )
        .eq("user_id", ctx.userId)
        .eq("sprint_date", todayIso)
        .neq("status", "done")
        .order("sprint_order"),
      ctx.supabase
        .from("s2d_items")
        .select(
          "id, ticket_number, title, pathway, priority, queue_reason, queue_until, snoozed_until"
        )
        .eq("user_id", ctx.userId)
        .or(
          `queue_until.lte.${endOfDay.toISOString()},snoozed_until.lte.${endOfDay.toISOString()}`
        )
        .eq("status", "in_queue")
        .limit(10),
    ]);

    return {
      today_iso: todayIso,
      calendar: calendar.data ?? [],
      urgent_items: urgent.data ?? [],
      sprint_items: sprint.data ?? [],
      resurfacing_items: resurfacing.data ?? [],
    };
  },
};
