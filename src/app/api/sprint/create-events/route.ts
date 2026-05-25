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

interface ItemRow {
  id: string;
  ticket_number: number | null;
  title: string;
  pathway: string;
  priority: string;
  description: string | null;
}

/**
 * POST /api/sprint/create-events
 *
 * 1. Stamps sprint_start_at / sprint_end_at on each S2D item (always).
 * 2. If createCalendarEvents is true and a calendar account is provided,
 *    creates ONE consolidated calendar event covering the entire sprint
 *    window (earliest block start → latest block end).
 *
 * Event design:
 *   - Title: "Working on: <title 1>, <title 2>, …" — every item's title
 *     joined, so the user's own calendar reads like a real day plan.
 *     Truncated to ~250 chars with a trailing "+N more" if the joined
 *     list runs long.
 *   - Description: per-block details (task title, pathway, priority,
 *     Mashi deep link, optional description) so opening the event
 *     surfaces the same context the planner shows.
 *   - The same calendar_event_id is stamped on every s2d_items row in
 *     the sprint — they all point at the same calendar entry.
 *
 * Why one event vs N per block: a sprint is one focus window. N events
 * stacked at the top of the day clutters the calendar and reads as
 * multiple meetings when it's really one block of self-time.
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
  const itemMap = new Map<string, ItemRow>(
    (items ?? []).map((i) => [i.id, i as ItemRow])
  );

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

  // Stamp per-block sprint_start_at / sprint_end_at first. Each block's
  // window stays per-item so the in-sprint UI keeps its block timing —
  // only the calendar push collapses to one event.
  for (const b of body.blocks) {
    const item = itemMap.get(b.s2dItemId);
    if (!item) continue;
    const start = new Date(b.startAt);
    const end = new Date(start.getTime() + b.durationMin * 60_000);
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
  }

  // Initial event response — one row per block, calendarEventId null
  // until we push. If no calendar push is requested (or no provider),
  // we return this as-is and the client uses the same shape.
  const events: Array<{
    s2dItemId: string;
    calendarEventId: string | null;
    error?: string;
  }> = body.blocks.map((b) => ({ s2dItemId: b.s2dItemId, calendarEventId: null }));

  if (!provider || !body.calendarAccountId) {
    return NextResponse.json({ ok: true, events });
  }

  // Build the one consolidated event covering the whole sprint window.
  // Earliest start, latest end. Skip blocks whose item we couldn't load
  // (item not found / cross-tenant guard tripped) — they get an error
  // entry in the per-block response.
  const validBlocks = body.blocks
    .map((b) => ({ block: b, item: itemMap.get(b.s2dItemId) }))
    .filter((x): x is { block: BlockIn; item: ItemRow } => !!x.item);

  for (const b of body.blocks) {
    if (!itemMap.get(b.s2dItemId)) {
      const idx = events.findIndex((e) => e.s2dItemId === b.s2dItemId);
      if (idx >= 0) events[idx].error = "item not found";
    }
  }

  if (validBlocks.length === 0) {
    return NextResponse.json({ ok: true, events });
  }

  const sprintStart = new Date(
    Math.min(...validBlocks.map((x) => new Date(x.block.startAt).getTime()))
  );
  const sprintEnd = new Date(
    Math.max(
      ...validBlocks.map(
        (x) => new Date(x.block.startAt).getTime() + x.block.durationMin * 60_000
      )
    )
  );

  try {
    const eventId =
      provider === "gcal"
        ? await createConsolidatedGoogleEvent({
            accountId: body.calendarAccountId,
            start: sprintStart,
            end: sprintEnd,
            blocks: validBlocks.map((x) => ({
              ticket: x.item.ticket_number != null ? `MASH-${x.item.ticket_number}` : null,
              title: x.item.title,
              pathway: x.item.pathway,
              priority: x.item.priority,
              description: x.item.description ?? null,
              mashiUrl: `${origin}/s2d?item=${x.item.id}`,
              durationMin: x.block.durationMin,
            })),
          })
        : null; // mscal: TODO when Outlook calendar push is wired

    // Stamp the SAME event_id on every item in the sprint.
    if (eventId) {
      for (const { item } of validBlocks) {
        await sb
          .from("s2d_items")
          .update({ sprint_calendar_event_id: eventId })
          .eq("user_id", user.id)
          .eq("id", item.id);
        const idx = events.findIndex((e) => e.s2dItemId === item.id);
        if (idx >= 0) events[idx].calendarEventId = eventId;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "calendar push failed";
    console.warn(`[sprint/create-events] consolidated event failed:`, msg);
    // Stamp the error on every block so the client can surface a single
    // sprint-level failure rather than implying per-item issues.
    for (const { item } of validBlocks) {
      const idx = events.findIndex((e) => e.s2dItemId === item.id);
      if (idx >= 0) events[idx].error = msg;
    }
  }

  return NextResponse.json({ ok: true, events });
}

const GCAL_API = "https://www.googleapis.com/calendar/v3";

interface ConsolidatedBlock {
  ticket: string | null;
  title: string;
  pathway: string;
  priority: string;
  description: string | null;
  mashiUrl: string;
  durationMin: number;
}

/**
 * Build "Working on: <title 1>, <title 2>, …". Caps at ~250 chars so
 * Google Calendar's summary column doesn't get a giant string nobody
 * can scan. Trailing "+N more" when truncated.
 */
function buildConsolidatedTitle(blocks: ConsolidatedBlock[]): string {
  const prefix = "Working on: ";
  const SOFT_LIMIT = 250;
  const titles = blocks.map((b) => b.title);
  let joined = "";
  let included = 0;
  for (const t of titles) {
    const next = joined.length === 0 ? t : `${joined}, ${t}`;
    if (`${prefix}${next}`.length > SOFT_LIMIT && included > 0) break;
    joined = next;
    included += 1;
  }
  const remaining = titles.length - included;
  return remaining > 0 ? `${prefix}${joined} +${remaining} more` : `${prefix}${joined}`;
}

/**
 * Build the description body: one section per block with task name,
 * pathway/priority, duration, optional description, and a Mashi link.
 */
function buildConsolidatedDescription(blocks: ConsolidatedBlock[]): string {
  const sections = blocks.map((b, i) => {
    const ticketPrefix = b.ticket ? `${b.ticket} · ` : "";
    const lines = [
      `${i + 1}. ${ticketPrefix}${b.title}`,
      `   ${b.pathway} · ${b.priority} · ${b.durationMin}m`,
      `   ${b.mashiUrl}`,
    ];
    if (b.description) {
      lines.push("");
      lines.push(
        b.description
          .slice(0, 1000)
          .split("\n")
          .map((l) => `   ${l}`)
          .join("\n")
      );
    }
    return lines.join("\n");
  });
  return sections.join("\n\n");
}

async function createConsolidatedGoogleEvent(opts: {
  accountId: string;
  start: Date;
  end: Date;
  blocks: ConsolidatedBlock[];
}): Promise<string | null> {
  const token = await getActiveAccessToken(opts.accountId);

  const body = {
    summary: buildConsolidatedTitle(opts.blocks),
    description: buildConsolidatedDescription(opts.blocks),
    start: { dateTime: opts.start.toISOString() },
    end: { dateTime: opts.end.toISOString() },
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
