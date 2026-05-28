import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";

const args = z
  .object({
    id: z.string().uuid().optional(),
    external_id: z.string().optional(),
  })
  .refine((v) => v.id != null || v.external_id != null, {
    message: "Provide `id` or `external_id`.",
  });

type Args = z.infer<typeof args>;

export const get_meeting: ToolDefinition<Args, unknown> = {
  name: "get_meeting",
  description:
    "Fetch one Fireflies meeting (by db id or Fireflies external_id) plus its extracted action items. Includes the meeting summary and attendee list.\n\nUse when: the user asks 'what was decided in the X meeting?', 'who attended?', or you have a meeting id from search_meetings and want its details. Example: { external_id: 'ff_abc123' }.\n\nDo NOT use to search for meetings (call search_meetings). Do NOT use to fetch calendar events — those are separate (use get_calendar_event).\n\nReturns: { meeting, action_items }. meeting is null when no row matches.",
  ring: "read",
  args,
  handler: async (input, ctx) => {
    let q = ctx.supabase
      .from("meetings")
      .select("*")
      .eq("user_id", ctx.userId)
      .limit(1);
    if (input.id) q = q.eq("id", input.id);
    else if (input.external_id) q = q.eq("external_id", input.external_id);

    const { data: meeting, error } = await q.maybeSingle();
    if (error) throw error;
    if (!meeting) return { meeting: null };

    const { data: actionItems } = await ctx.supabase
      .from("action_items")
      .select("id, description, assignee, due_date, status")
      .eq("user_id", ctx.userId)
      .eq("source_meeting_id", meeting.id);

    return { meeting, action_items: actionItems ?? [] };
  },
};
