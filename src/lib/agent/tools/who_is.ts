import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";

const args = z.object({
  identifier: z.string().min(1, "`identifier` (name or email) required"),
  limit_per_source: z.number().int().min(1).max(25).optional(),
});

type Args = z.infer<typeof args>;

interface Attendee {
  email?: string | null;
  name?: string | null;
}

export const who_is: ToolDefinition<Args, unknown> = {
  name: "who_is",
  description:
    "Cross-source person lookup. Returns recent meetings they attended, messages from/to them (Gmail + Slack), Linear issues they own, and S2D items mentioning them.",
  ring: "read",
  args,
  handler: async (input, ctx) => {
    const id = input.identifier.trim();
    const safe = id.replace(/[%_]/g, "");
    const lim = Math.min(Math.max(input.limit_per_source ?? 5, 1), 25);
    const isEmail = id.includes("@");

    const gmailPromise = ctx.supabase
      .from("messages")
      .select(
        "id, source, subject, sender_name, sender_email, preview, received_at"
      )
      .eq("user_id", ctx.userId)
      .eq("source", "gmail")
      .or(
        isEmail
          ? `sender_email.ilike.%${safe}%`
          : `sender_name.ilike.%${safe}%,sender_email.ilike.%${safe}%`
      )
      .order("received_at", { ascending: false })
      .limit(lim);

    const slackPromise = ctx.supabase
      .from("messages")
      .select("id, source, sender_name, channel, preview, received_at")
      .eq("user_id", ctx.userId)
      .eq("source", "slack")
      .or(`sender_name.ilike.%${safe}%,sender_email.ilike.%${safe}%`)
      .order("received_at", { ascending: false })
      .limit(lim);

    const linearPromise = ctx.supabase
      .from("linear_issues")
      .select("id, title, status, url, assignee_name, assignee_email")
      .eq("user_id", ctx.userId)
      .or(
        isEmail
          ? `assignee_email.ilike.%${safe}%`
          : `assignee_name.ilike.%${safe}%,assignee_email.ilike.%${safe}%`
      )
      .limit(lim);

    const s2dPromise = ctx.supabase
      .from("s2d_items")
      .select("id, ticket_number, title, pathway, status, delegated_to")
      .eq("user_id", ctx.userId)
      .or(
        `title.ilike.%${safe}%,description.ilike.%${safe}%,delegated_to.ilike.%${safe}%`
      )
      .order("updated_at", { ascending: false })
      .limit(lim);

    const meetingsPromise = ctx.supabase
      .from("meetings")
      .select("id, title, date, attendees, summary")
      .eq("user_id", ctx.userId)
      .order("date", { ascending: false })
      .limit(100);

    const [gmail, slack, linear, s2d, meetings] = await Promise.all([
      gmailPromise,
      slackPromise,
      linearPromise,
      s2dPromise,
      meetingsPromise,
    ]);

    const idLower = id.toLowerCase();
    const meetingHits = (meetings.data ?? [])
      .filter((m) => {
        const list = (m.attendees as Attendee[] | null) ?? [];
        return list.some((a) => {
          const e = (a.email ?? "").toLowerCase();
          const n = (a.name ?? "").toLowerCase();
          return e.includes(idLower) || n.includes(idLower);
        });
      })
      .slice(0, lim)
      .map((m) => ({ id: m.id, title: m.title, date: m.date }));

    return {
      identifier: id,
      gmail: gmail.data ?? [],
      slack: slack.data ?? [],
      linear: linear.data ?? [],
      s2d_items: s2d.data ?? [],
      meetings: meetingHits,
      counts: {
        gmail: gmail.data?.length ?? 0,
        slack: slack.data?.length ?? 0,
        linear: linear.data?.length ?? 0,
        s2d_items: s2d.data?.length ?? 0,
        meetings: meetingHits.length,
      },
    };
  },
};
