import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";
import { getActiveAccessToken } from "@/lib/oauth/flow";

const args = z.object({
  title: z.string().min(1).max(1024),
  start: z
    .string()
    .describe("ISO datetime for the event start (e.g. 2026-06-01T10:00:00-04:00)."),
  end: z
    .string()
    .describe("ISO datetime for the event end."),
  attendees: z.array(z.string()).default([]).optional(),
  description: z.string().max(8_000).optional(),
  link_item_id: z
    .string()
    .uuid()
    .optional()
    .describe("Optional S2D item id to link this event back to."),
});

type Args = z.infer<typeof args>;

const GCAL_API = "https://www.googleapis.com/calendar/v3";

/**
 * Ring-3 create_calendar_event — creates an event on the user's
 * primary connected Google Calendar. Requires user approval.
 */
export const create_calendar_event: ToolDefinition<
  Args,
  {
    ok: boolean;
    event_id?: string;
    html_link?: string;
    error?: string;
  }
> = {
  name: "create_calendar_event",
  description:
    "Create a calendar event on the user's primary connected calendar (Google Calendar). Requires user approval. Pass ISO datetimes for start/end.",
  ring: "write_world",
  args,
  handler: async (input, ctx) => {
    const { data: conn } = await ctx.supabase
      .from("connected_accounts")
      .select("id, provider")
      .eq("user_id", ctx.userId)
      .eq("provider", "gcal")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!conn) {
      return { ok: false, error: "No Google Calendar connected." };
    }
    const token = await getActiveAccessToken(conn.id);

    const start = new Date(input.start);
    const end = new Date(input.end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return { ok: false, error: "Invalid start or end datetime." };
    }
    if (end.getTime() <= start.getTime()) {
      return { ok: false, error: "End must be after start." };
    }

    const payload: Record<string, unknown> = {
      summary: input.title,
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
    };
    if (input.description) payload.description = input.description;
    if (input.attendees && input.attendees.length > 0) {
      payload.attendees = input.attendees.map((email) => ({ email }));
    }

    const res = await fetch(`${GCAL_API}/calendars/primary/events`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        error: `Calendar create failed: ${res.status} ${text.slice(0, 200)}`,
      };
    }
    const j = (await res.json()) as { id?: string; htmlLink?: string };
    return {
      ok: true,
      event_id: j.id,
      html_link: j.htmlLink,
    };
  },
};
