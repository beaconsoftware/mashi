import { mcpTool } from "@/lib/mcp/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Args {
  /** Person's name OR email — best effort match across sources */
  identifier: string;
  /** Default 5 hits per source */
  limit_per_source?: number;
}

interface Attendee {
  email?: string | null;
  name?: string | null;
}

/**
 * Cross-source person lookup. Returns:
 *   - Recent meetings they attended (Fireflies + Calendar)
 *   - Recent messages from/to them (Gmail, Slack)
 *   - Linear issues they're assigned to
 *   - S2D items mentioning them
 *
 * "identifier" is matched loosely against email, name, sender fields.
 */
export const POST = mcpTool<Args, unknown>(async (args, ctx) => {
  const id = args.identifier?.trim();
  if (!id) throw new Error("`identifier` (name or email) required");
  const safe = id.replace(/[%_]/g, "");
  const lim = Math.min(Math.max(args.limit_per_source ?? 5, 1), 25);
  const isEmail = id.includes("@");

  // Gmail messages from this sender
  const gmailPromise = ctx.supabase
    .from("messages")
    .select("id, source, subject, sender_name, sender_email, preview, received_at")
    .eq("user_id", ctx.userId)
    .eq("source", "gmail")
    .or(
      isEmail
        ? `sender_email.ilike.%${safe}%`
        : `sender_name.ilike.%${safe}%,sender_email.ilike.%${safe}%`
    )
    .order("received_at", { ascending: false })
    .limit(lim);

  // Slack messages
  const slackPromise = ctx.supabase
    .from("messages")
    .select("id, source, sender_name, channel, preview, received_at")
    .eq("user_id", ctx.userId)
    .eq("source", "slack")
    .or(`sender_name.ilike.%${safe}%,sender_email.ilike.%${safe}%`)
    .order("received_at", { ascending: false })
    .limit(lim);

  // Linear issues assigned to them
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

  // S2D items where they're delegated_to or mentioned in title/desc
  const s2dPromise = ctx.supabase
    .from("s2d_items")
    .select("id, ticket_number, title, pathway, status, delegated_to")
    .eq("user_id", ctx.userId)
    .or(`title.ilike.%${safe}%,description.ilike.%${safe}%,delegated_to.ilike.%${safe}%`)
    .order("updated_at", { ascending: false })
    .limit(lim);

  // Recent meetings — we filter client-side since attendees is JSONB
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
});
