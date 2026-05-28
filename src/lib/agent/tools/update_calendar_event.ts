import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";
import { getActiveAccessToken } from "@/lib/oauth/flow";

const patch = z
  .object({
    title: z.string().min(1).max(1024).optional(),
    start: z.string().optional(),
    end: z.string().optional(),
    description: z.string().max(8_000).optional(),
    attendees: z.array(z.string()).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "patch must include at least one field",
  });

const args = z.object({
  id: z
    .string()
    .min(1)
    .describe(
      "Calendar event id. Accepts either the calendar_events.id (UUID) or the provider external_id (e.g. gcal event id)."
    ),
  patch,
});

type Args = z.infer<typeof args>;

const GCAL_API = "https://www.googleapis.com/calendar/v3";

/**
 * Ring-3 update_calendar_event — PATCHes an event on the user's
 * primary Google Calendar. Requires user approval.
 */
export const update_calendar_event: ToolDefinition<
  Args,
  { ok: boolean; event_id?: string; error?: string }
> = {
  name: "update_calendar_event",
  description:
    "PATCH fields on an existing Google Calendar event (title, start, end, description, attendees). Pause-and-approve: the call surfaces the approval card; the change fires only after the user clicks Approve. id accepts either the calendar_events.id (UUID) or the provider external_id.\n\nUse when: the user asks to move / rename / re-attendee an event ('push the Maya meeting to Friday', 'add Mihir to the 2pm'). Example: { id: 'gcal_abc123', patch: { start: '2026-06-04T14:00:00-04:00', end: '2026-06-04T14:30:00-04:00' } }.\n\nDo NOT use to create a new event (call create_calendar_event). Do NOT use to fetch an event (call get_calendar_event first to confirm details).\n\nReturns: { ok, event_id } on success; { ok: false, error } when no GCal is connected, the datetimes are invalid, or Google rejects the patch.",
  ring: "write_world",
  args,
  handler: async (input, ctx) => {
    let externalId: string | null = null;
    let connectionId: string | null = null;

    const { data: row } = await ctx.supabase
      .from("calendar_events")
      .select("external_id, connected_account_id")
      .eq("user_id", ctx.userId)
      .or(`id.eq.${input.id},external_id.eq.${input.id}`)
      .limit(1)
      .maybeSingle();
    if (row) {
      externalId = row.external_id ?? null;
      connectionId = row.connected_account_id ?? null;
    }
    if (!externalId) externalId = input.id;
    if (!connectionId) {
      const { data: conn } = await ctx.supabase
        .from("connected_accounts")
        .select("id")
        .eq("user_id", ctx.userId)
        .eq("provider", "gcal")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      connectionId = conn?.id ?? null;
    }
    if (!connectionId) {
      return { ok: false, error: "No Google Calendar connected." };
    }
    const token = await getActiveAccessToken(connectionId);

    const payload: Record<string, unknown> = {};
    if (input.patch.title) payload.summary = input.patch.title;
    if (input.patch.description !== undefined)
      payload.description = input.patch.description;
    if (input.patch.start) {
      const start = new Date(input.patch.start);
      if (Number.isNaN(start.getTime())) {
        return { ok: false, error: "Invalid start datetime." };
      }
      payload.start = { dateTime: start.toISOString() };
    }
    if (input.patch.end) {
      const end = new Date(input.patch.end);
      if (Number.isNaN(end.getTime())) {
        return { ok: false, error: "Invalid end datetime." };
      }
      payload.end = { dateTime: end.toISOString() };
    }
    if (input.patch.attendees) {
      payload.attendees = input.patch.attendees.map((email) => ({ email }));
    }

    const res = await fetch(
      `${GCAL_API}/calendars/primary/events/${encodeURIComponent(externalId)}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        error: `Calendar update failed: ${res.status} ${text.slice(0, 200)}`,
      };
    }
    const j = (await res.json()) as { id?: string };
    return { ok: true, event_id: j.id };
  },
};
