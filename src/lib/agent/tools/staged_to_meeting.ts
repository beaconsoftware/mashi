import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";

const args = z.object({
  item_id: z.string().uuid(),
  calendar_event_id: z
    .string()
    .min(1)
    .describe(
      "Either calendar_events.id (UUID) or the provider external_id (gcal event id)."
    ),
  talking_points: z.string().min(1).max(8_000),
});

type Args = z.infer<typeof args>;

interface StoredEnrichedContext {
  staged_meeting?: { calendarEventId: string; talkingPoints: string };
  [k: string]: unknown;
}

/**
 * Ring-3 staged_to_meeting — closes a meeting-backed S2D item by
 * staging it for a specific upcoming meeting. Wraps the same logic as
 * POST /api/s2d/:id/stage-meeting but invocable from the agent loop.
 *
 * Marked ring 3 because it changes the user's day plan (the meeting
 * itself is visible to attendees) and the user should explicitly
 * approve the staging before the agent commits it.
 */
export const staged_to_meeting: ToolDefinition<
  Args,
  { ok: boolean; outcome?: string; error?: string }
> = {
  name: "staged_to_meeting",
  description:
    "Stage an S2D item for an upcoming meeting: persists talking points and marks the item done with resolved_via=meeting:staged. Requires user approval.",
  ring: "write_world",
  args,
  handler: async (input, ctx) => {
    const { data: item, error } = await ctx.supabase
      .from("s2d_items")
      .select("id, title, enriched_context")
      .eq("user_id", ctx.userId)
      .eq("id", input.item_id)
      .maybeSingle();
    if (error) throw error;
    if (!item) return { ok: false, error: "Item not found." };

    const { data: events } = await ctx.supabase
      .from("calendar_events")
      .select("id, external_id, title, start_at")
      .eq("user_id", ctx.userId)
      .or(
        `id.eq.${input.calendar_event_id},external_id.eq.${input.calendar_event_id}`
      )
      .limit(1);
    const ev = (events as Array<{
      id: string;
      external_id: string | null;
      title: string | null;
      start_at: string;
    }> | null)?.[0];
    const eventLabel = ev?.title?.trim() || "the meeting";

    const now = new Date().toISOString();
    const enriched = {
      ...((item.enriched_context ?? {}) as StoredEnrichedContext),
    };
    enriched.staged_meeting = {
      calendarEventId: input.calendar_event_id,
      talkingPoints: input.talking_points,
    };

    const outcomeLine = `Staged for ${eventLabel}, ${input.talking_points
      .split("\n")[0]
      .slice(0, 80)}`;

    const { error: updErr } = await ctx.supabase
      .from("s2d_items")
      .update({
        enriched_context: enriched,
        status: "done",
        done_at: now,
        outcome: outcomeLine,
        resolved_via: "meeting:staged",
        has_unseen_updates: true,
        last_update_summary: outcomeLine,
        last_update_at: now,
      })
      .eq("user_id", ctx.userId)
      .eq("id", item.id);
    if (updErr) return { ok: false, error: updErr.message };

    return { ok: true, outcome: outcomeLine };
  },
};
