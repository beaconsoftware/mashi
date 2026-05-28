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
    "Wide agent-orientation snapshot for today: calendar events, items with planned_for=today, items resurfacing from snooze, plus the active sprint session (if one is in progress).\n\nUse when: starting a 'what's my day look like?' or 'should I do a sprint now?' conversation. Wider than list_today because it also pulls the active sprint shape. Example: {}.\n\nDo NOT use when the user only wants the active sprint shape (call get_current_sprint). Do NOT call repeatedly per turn — one snapshot per orientation is enough.\n\nReturns: { today_iso, calendar, planned_for_today, resurfacing_items, active_sprint }. active_sprint is null when no sprint is in progress.",
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
