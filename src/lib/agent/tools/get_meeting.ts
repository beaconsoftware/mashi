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
    "Fetch a single Fireflies meeting (by db id or Fireflies external_id) plus its action items.",
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
