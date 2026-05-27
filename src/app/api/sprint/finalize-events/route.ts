import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";
import { getActiveAccessToken } from "@/lib/oauth/flow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface FinalizeIn {
  s2dItemId: string;
  status: "done" | "skipped";
  /** Actual focused minutes (rounded). Computed client-side from per-block accumulatedMs. */
  actualMin: number;
}

interface FinalizeBody {
  mode?: "finalize";
  blocks: FinalizeIn[];
}

/**
 * Phase 7: extend the running sprint's consolidated calendar event when
 * a new item is added mid-sprint. Reuses the same route so we keep all
 * sprint-invite mutation behind one auth + provider-resolution surface.
 *
 * Reads the sprint event id from any existing sprint item (every item
 * in a sprint shares the same `sprint_calendar_event_id`), GETs the
 * event, extends `end` by `durationMin` minutes, appends one line per
 * item to the description, and stamps the same event id +
 * sprint_start_at/end_at + sprint_calendar_account_id on the added
 * item so finalize-mode can clean up its calendar pointer at sprint
 * complete.
 *
 * If no current sprint item has a calendar event (user opted out of
 * calendar push at planning time), no calendar mutation runs; the
 * route still stamps sprint_start_at/end_at on the added item.
 */
interface ExtendBody {
  mode: "extend-for-add";
  s2dItemId: string;
  durationMin: number;
}

type Body = FinalizeBody | ExtendBody;

/**
 * POST /api/sprint/finalize-events
 *
 * Called from sprint-complete.tsx after a sprint ends. For each block:
 *  - done:    PATCH the calendar event so its end = start + actualMin,
 *             and prepend an "Actual: Xm (planned Ym)" line to the
 *             description. We don't move start — the time block on the
 *             calendar still anchors to when work was planned, just
 *             trimmed/extended to reflect reality.
 *  - skipped: DELETE the calendar event (it didn't happen, no point
 *             leaving a 0-min ghost on the calendar).
 *
 * Blocks without a stored sprint_calendar_event_id are skipped (e.g. the
 * user opted out of calendar events at planning time). Also stamps
 * actual_min on s2d_items.sprint_actual_min for board-level analytics.
 *
 * Errors per-block don't fail the whole call — returns a per-block
 * result so the UI can surface partial success.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as Body;

  const userSb = await createSupabaseServerClient();
  const {
    data: { user },
  } = await userSb.auth.getUser();
  if (!user) return new Response("unauthorized", { status: 401 });

  const sb = createSupabaseServiceClient();

  if ("mode" in body && body.mode === "extend-for-add") {
    return handleExtendForAdd(sb, user.id, body);
  }

  if (!("blocks" in body) || !Array.isArray(body.blocks) || body.blocks.length === 0) {
    return NextResponse.json({ error: "no blocks" }, { status: 400 });
  }

  const ids = body.blocks.map((b) => b.s2dItemId);
  const { data: items } = await sb
    .from("s2d_items")
    .select(
      "id, ticket_number, title, sprint_start_at, sprint_end_at, sprint_calendar_event_id, sprint_calendar_account_id"
    )
    .eq("user_id", user.id)
    .in("id", ids);
  const itemMap = new Map((items ?? []).map((i) => [i.id, i]));

  const results: Array<{
    s2dItemId: string;
    ok: boolean;
    calendarUpdated: boolean;
    error?: string;
  }> = [];

  for (const b of body.blocks) {
    const item = itemMap.get(b.s2dItemId);
    if (!item) {
      results.push({
        s2dItemId: b.s2dItemId,
        ok: false,
        calendarUpdated: false,
        error: "item not found",
      });
      continue;
    }

    // Stamp the actual focus minutes on the item regardless of whether
    // there's a calendar event — useful for board-level "where did my
    // week go" rollups that don't require a calendar push.
    await sb
      .from("s2d_items")
      .update({ sprint_actual_min: b.actualMin })
      .eq("user_id", user.id)
      .eq("id", item.id);

    const eventId = item.sprint_calendar_event_id;
    const accountId = item.sprint_calendar_account_id;
    if (!eventId || !accountId) {
      results.push({ s2dItemId: item.id, ok: true, calendarUpdated: false });
      continue;
    }

    try {
      if (b.status === "skipped") {
        await deleteGoogleEvent({ accountId, eventId });
      } else {
        const start = item.sprint_start_at ? new Date(item.sprint_start_at) : null;
        const plannedEnd = item.sprint_end_at ? new Date(item.sprint_end_at) : null;
        if (!start) {
          results.push({
            s2dItemId: item.id,
            ok: false,
            calendarUpdated: false,
            error: "missing sprint_start_at",
          });
          continue;
        }
        const plannedMin = plannedEnd
          ? Math.max(1, Math.round((plannedEnd.getTime() - start.getTime()) / 60_000))
          : null;
        // Clamp actual to >= 1min so the event remains visible even if
        // the user instantly marked done (likely already-done before sprint).
        const actualMin = Math.max(1, b.actualMin);
        const newEnd = new Date(start.getTime() + actualMin * 60_000);

        await patchGoogleEvent({
          accountId,
          eventId,
          newEnd,
          actualMin,
          plannedMin,
        });
      }
      // Clear the calendar pointers on done/skipped so a re-finalize doesn't
      // try to update a deleted event. Keep sprint_start_at/end_at as the
      // historical record of when this block ran.
      await sb
        .from("s2d_items")
        .update({
          sprint_calendar_event_id: null,
        })
        .eq("user_id", user.id)
        .eq("id", item.id);
      results.push({ s2dItemId: item.id, ok: true, calendarUpdated: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "calendar update failed";
      console.warn(`[sprint/finalize-events] ${item.id} failed:`, msg);
      results.push({
        s2dItemId: item.id,
        ok: false,
        calendarUpdated: false,
        error: msg,
      });
    }
  }

  return NextResponse.json({ ok: true, results });
}

const GCAL_API = "https://www.googleapis.com/calendar/v3";

/**
 * Marker line we prepend to the description so a second finalize pass
 * (rare, but possible if the user re-runs cleanup) can strip and replace
 * cleanly rather than stacking notes.
 */
const ACTUAL_MARKER = "[mashi/actual]";

async function patchGoogleEvent(opts: {
  accountId: string;
  eventId: string;
  newEnd: Date;
  actualMin: number;
  plannedMin: number | null;
}): Promise<void> {
  const token = await getActiveAccessToken(opts.accountId);

  // GET first so we can splice the actual-line into the existing description
  // without losing the user's deep-link to the Mashi task.
  const getRes = await fetch(
    `${GCAL_API}/calendars/primary/events/${encodeURIComponent(opts.eventId)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!getRes.ok) {
    const t = await getRes.text();
    throw new Error(`gcal GET ${getRes.status} ${t.slice(0, 200)}`);
  }
  const evt = (await getRes.json()) as { description?: string };

  const existing = (evt.description ?? "")
    .split("\n")
    .filter((line) => !line.includes(ACTUAL_MARKER))
    .join("\n");
  const note =
    opts.plannedMin != null && opts.plannedMin !== opts.actualMin
      ? `${ACTUAL_MARKER} Actual: ${opts.actualMin}m (planned ${opts.plannedMin}m)`
      : `${ACTUAL_MARKER} Actual: ${opts.actualMin}m`;
  const description = `${note}\n${existing}`.trimEnd();

  const res = await fetch(
    `${GCAL_API}/calendars/primary/events/${encodeURIComponent(opts.eventId)}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        end: { dateTime: opts.newEnd.toISOString() },
        description,
      }),
    }
  );
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`gcal PATCH ${res.status} ${t.slice(0, 200)}`);
  }
}

/**
 * Marker line we append per added-item to the description so a second
 * extend pass doesn't stack duplicates for the same item.
 */
const ADDED_MARKER = "[mashi/added]";

type ServiceClient = ReturnType<typeof createSupabaseServiceClient>;

async function handleExtendForAdd(
  sb: ServiceClient,
  userId: string,
  body: ExtendBody
) {
  // Look up the added item (title + ticket for the description) and any
  // sibling sprint item that already has a calendar event id stamped.
  const [{ data: addedItem }, { data: siblings }] = await Promise.all([
    sb
      .from("s2d_items")
      .select("id, ticket_number, title")
      .eq("user_id", userId)
      .eq("id", body.s2dItemId)
      .maybeSingle(),
    sb
      .from("s2d_items")
      .select("id, sprint_calendar_event_id, sprint_calendar_account_id, sprint_end_at")
      .eq("user_id", userId)
      .neq("id", body.s2dItemId)
      .not("sprint_calendar_event_id", "is", null)
      .order("sprint_end_at", { ascending: false })
      .limit(1),
  ]);

  if (!addedItem) {
    return NextResponse.json({ error: "item not found" }, { status: 404 });
  }

  const now = new Date();
  const itemEnd = new Date(now.getTime() + body.durationMin * 60_000);

  // Always stamp sprint_start_at / sprint_end_at on the added item so
  // finalize-mode (at sprint complete) can anchor its actualMin clamp
  // and the recap can compute "planned vs actual" later.
  await sb
    .from("s2d_items")
    .update({
      sprint_start_at: now.toISOString(),
      sprint_end_at: itemEnd.toISOString(),
      sprint_date: now.toISOString().slice(0, 10),
    })
    .eq("user_id", userId)
    .eq("id", addedItem.id);

  const sibling = (siblings ?? [])[0];
  if (!sibling || !sibling.sprint_calendar_event_id || !sibling.sprint_calendar_account_id) {
    // No sprint calendar event (user opted out at planning time). Local
    // add is the only side effect; the client treats this as success.
    return NextResponse.json({ ok: true, calendarUpdated: false });
  }

  const eventId = sibling.sprint_calendar_event_id;
  const accountId = sibling.sprint_calendar_account_id;
  const addedLabel = `${ADDED_MARKER} ${
    addedItem.ticket_number != null ? `MASH-${addedItem.ticket_number} ` : ""
  }${addedItem.title}`;

  try {
    await extendGoogleEvent({
      accountId,
      eventId,
      extendMinutes: body.durationMin,
      addedLine: addedLabel,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "calendar update failed";
    console.warn(`[sprint/finalize-events extend] ${addedItem.id} failed:`, msg);
    return NextResponse.json(
      { ok: false, calendarUpdated: false, error: msg },
      { status: 200 } // non-blocking failure: local add already happened
    );
  }

  // Stamp the same event id + account so finalize-mode reconciles it
  // later (delete on skip / patch end on done).
  await sb
    .from("s2d_items")
    .update({
      sprint_calendar_event_id: eventId,
      sprint_calendar_account_id: accountId,
    })
    .eq("user_id", userId)
    .eq("id", addedItem.id);

  return NextResponse.json({ ok: true, calendarUpdated: true });
}

async function extendGoogleEvent(opts: {
  accountId: string;
  eventId: string;
  extendMinutes: number;
  addedLine: string;
}): Promise<void> {
  const token = await getActiveAccessToken(opts.accountId);

  const getRes = await fetch(
    `${GCAL_API}/calendars/primary/events/${encodeURIComponent(opts.eventId)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!getRes.ok) {
    const t = await getRes.text();
    throw new Error(`gcal GET ${getRes.status} ${t.slice(0, 200)}`);
  }
  const evt = (await getRes.json()) as {
    description?: string;
    end?: { dateTime?: string };
  };

  const currentEnd = evt.end?.dateTime ? new Date(evt.end.dateTime) : null;
  if (!currentEnd) {
    throw new Error("event missing end.dateTime");
  }
  const newEnd = new Date(currentEnd.getTime() + opts.extendMinutes * 60_000);

  const existing = evt.description ?? "";
  // Dedupe: if the exact addedLine already appears, skip re-appending
  // (idempotent retries shouldn't stack duplicate lines).
  const description = existing.includes(opts.addedLine)
    ? existing
    : `${existing}${existing && !existing.endsWith("\n") ? "\n" : ""}${opts.addedLine}`;

  const res = await fetch(
    `${GCAL_API}/calendars/primary/events/${encodeURIComponent(opts.eventId)}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        end: { dateTime: newEnd.toISOString() },
        description,
      }),
    }
  );
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`gcal PATCH ${res.status} ${t.slice(0, 200)}`);
  }
}

async function deleteGoogleEvent(opts: {
  accountId: string;
  eventId: string;
}): Promise<void> {
  const token = await getActiveAccessToken(opts.accountId);
  const res = await fetch(
    `${GCAL_API}/calendars/primary/events/${encodeURIComponent(opts.eventId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  // 410 = already gone, treat as success.
  if (!res.ok && res.status !== 410 && res.status !== 404) {
    const t = await res.text();
    throw new Error(`gcal DELETE ${res.status} ${t.slice(0, 200)}`);
  }
}
