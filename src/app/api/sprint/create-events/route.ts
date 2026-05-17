import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";
import { getActiveAccessToken } from "@/lib/oauth/flow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface BlockIn {
  s2dItemId: string;
  startAt: string;
  durationMin: number;
}

interface Body {
  blocks: BlockIn[];
  createCalendarEvents: boolean;
  calendarAccountId: string | null;
}

/**
 * POST /api/sprint/create-events
 *
 * 1. Stamps sprint_start_at / sprint_end_at on each S2D item (always).
 * 2. If createCalendarEvents is true and a calendar account is provided,
 *    creates one event per block on the user's calendar.
 *
 * Event design (per user preference):
 *   - Title is JUST the ticket id ("MASH-415") so peers on a shared
 *     calendar view see a vague reference but no work titles.
 *   - Description carries the full task title, pathway, priority, and a
 *     deep link back to the Mashi detail page so the user always has
 *     one click back to the task they planned to do.
 *   - Visibility uses the calendar's default — typically "details visible
 *     to people with calendar access". The ticket-only title is the
 *     primary privacy lever.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as Body;
  if (!Array.isArray(body.blocks) || body.blocks.length === 0) {
    return NextResponse.json({ error: "no blocks" }, { status: 400 });
  }

  const userSb = await createSupabaseServerClient();
  const {
    data: { user },
  } = await userSb.auth.getUser();
  if (!user) return new Response("unauthorized", { status: 401 });

  // Service client for cross-table writes
  const sb = createSupabaseServiceClient();

  // Fetch the items we're scheduling — scoped to this user via service-role
  // (service-role bypasses RLS; without the user_id filter, anyone with
  // guessed UUIDs could schedule events for another tenant's items).
  const ids = body.blocks.map((b) => b.s2dItemId);
  const { data: items } = await sb
    .from("s2d_items")
    .select("id, ticket_number, title, pathway, priority, description")
    .eq("user_id", user.id)
    .in("id", ids);
  const itemMap = new Map((items ?? []).map((i) => [i.id, i]));

  const origin = req.nextUrl.origin;

  // Resolve calendar provider — also user-scoped
  let provider: "gcal" | "mscal" | null = null;
  if (body.createCalendarEvents && body.calendarAccountId) {
    const { data: acct } = await sb
      .from("connected_accounts")
      .select("provider")
      .eq("user_id", user.id)
      .eq("id", body.calendarAccountId)
      .single();
    if (acct?.provider === "gcal" || acct?.provider === "mscal") {
      provider = acct.provider;
    }
  }

  const events: Array<{
    s2dItemId: string;
    calendarEventId: string | null;
    error?: string;
  }> = [];

  for (const b of body.blocks) {
    const item = itemMap.get(b.s2dItemId);
    if (!item) {
      events.push({ s2dItemId: b.s2dItemId, calendarEventId: null, error: "item not found" });
      continue;
    }

    const start = new Date(b.startAt);
    const end = new Date(start.getTime() + b.durationMin * 60_000);

    // Stamp the sprint window on the item (still scoped by user_id even
    // though item.id only resolves to this user's rows above — defense in
    // depth in case the loop is ever fed external ids).
    await sb
      .from("s2d_items")
      .update({
        sprint_start_at: start.toISOString(),
        sprint_end_at: end.toISOString(),
        sprint_date: start.toISOString().slice(0, 10),
        sprint_calendar_account_id: provider ? body.calendarAccountId : null,
      })
      .eq("user_id", user.id)
      .eq("id", item.id);

    if (!provider || !body.calendarAccountId) {
      events.push({ s2dItemId: item.id, calendarEventId: null });
      continue;
    }

    try {
      const eventId =
        provider === "gcal"
          ? await createGoogleEvent({
              accountId: body.calendarAccountId,
              start,
              end,
              ticket: `MASH-${item.ticket_number}`,
              title: item.title,
              pathway: item.pathway,
              priority: item.priority,
              description: item.description ?? null,
              mashiUrl: `${origin}/s2d?item=${item.id}`,
            })
          : null; // mscal: TODO when Outlook calendar push is wired

      await sb
        .from("s2d_items")
        .update({ sprint_calendar_event_id: eventId })
        .eq("user_id", user.id)
        .eq("id", item.id);
      events.push({ s2dItemId: item.id, calendarEventId: eventId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "calendar push failed";
      console.warn(`[sprint/create-events] ${item.id} failed:`, msg);
      events.push({ s2dItemId: item.id, calendarEventId: null, error: msg });
    }
  }

  return NextResponse.json({ ok: true, events });
}

const GCAL_API = "https://www.googleapis.com/calendar/v3";

async function createGoogleEvent(opts: {
  accountId: string;
  start: Date;
  end: Date;
  ticket: string;
  title: string;
  pathway: string;
  priority: string;
  description: string | null;
  mashiUrl: string;
}): Promise<string | null> {
  const token = await getActiveAccessToken(opts.accountId);

  const descLines = [
    `Task: ${opts.title}`,
    `Pathway: ${opts.pathway}  ·  Priority: ${opts.priority}`,
    `Mashi: ${opts.mashiUrl}`,
  ];
  if (opts.description) {
    descLines.push("");
    descLines.push(opts.description.slice(0, 2000));
  }

  const body = {
    summary: opts.ticket,
    description: descLines.join("\n"),
    start: { dateTime: opts.start.toISOString() },
    end: { dateTime: opts.end.toISOString() },
    // Calendar default visibility; private/public toggles can be added later
    transparency: "opaque", // shows as busy
  };

  const res = await fetch(`${GCAL_API}/calendars/primary/events`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`gcal ${res.status} ${t.slice(0, 200)}`);
  }
  const j = (await res.json()) as { id?: string };
  return j.id ?? null;
}
