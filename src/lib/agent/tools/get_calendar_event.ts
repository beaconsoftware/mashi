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

export const get_calendar_event: ToolDefinition<Args, unknown> = {
  name: "get_calendar_event",
  description: "Fetch a single calendar event by db id or provider external_id.",
  ring: "read",
  args,
  handler: async (input, ctx) => {
    let q = ctx.supabase
      .from("calendar_events")
      .select("*")
      .eq("user_id", ctx.userId)
      .limit(1);
    if (input.id) q = q.eq("id", input.id);
    else if (input.external_id) q = q.eq("external_id", input.external_id);

    const { data, error } = await q.maybeSingle();
    if (error) throw error;
    return { event: data ?? null };
  },
};
