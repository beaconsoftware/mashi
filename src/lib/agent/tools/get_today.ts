import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";

const args = z.object({}).optional().default({});

type Args = z.infer<typeof args>;

/**
 * One-call orientation for the agent at the start of a conversation.
 * Today's calendar, items planned for today, items resurfacing from
 * snooze, and active sprint state (if any) in one round-trip.
 *
 * Distinct from the existing `list_today`: that surface mirrors what
 * the cockpit shows the user. `get_today` is wider — it also pulls the
 * active sprint shape so the agent doesn't have to follow up with
 * `get_current_sprint` for routine "what's my day look like" turns.
 */
export const get_today: ToolDefinition<Args, unknown> = {
  name: "get_today",
  description:
    "Agent orientation: today's calendar events, items planned_for=today, items resurfacing from snooze, plus active sprint state if one is in progress.",
  ring: "read",
  args,
  handler: async (_input, ctx) => {
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);
    const todayIso = startOfDay.toISOString().slice(0, 10);

    const [calendar, plannedToday, resurfacing, activeSprint] =
      await Promise.all([
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
            "id, ticket_number, title, pathway, priority, status, est_minutes"
          )
          .eq("user_id", ctx.userId)
          .eq("planned_for", todayIso)
          .neq("status", "done")
          .order("priority"),
        ctx.supabase
          .from("s2d_items")
          .select(
            "id, ticket_number, title, pathway, priority, snoozed_until, queue_reason"
          )
          .eq("user_id", ctx.userId)
          .lte("snoozed_until", endOfDay.toISOString())
          .eq("status", "in_queue")
          .limit(20),
        ctx.supabase
          .from("sprint_sessions")
          .select(
            "id, started_at, completed_at, planned_items, results, theme, notes"
          )
          .eq("user_id", ctx.userId)
          .is("completed_at", null)
          .order("started_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

    return {
      today_iso: todayIso,
      calendar: calendar.data ?? [],
      planned_for_today: plannedToday.data ?? [],
      resurfacing_items: resurfacing.data ?? [],
      active_sprint: activeSprint.data ?? null,
    };
  },
};
