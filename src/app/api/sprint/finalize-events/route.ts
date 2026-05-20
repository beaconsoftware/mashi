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

interface Body {
  blocks: FinalizeIn[];
}

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
  if (!Array.isArray(body.blocks) || body.blocks.length === 0) {
    return NextResponse.json({ error: "no blocks" }, { status: 400 });
  }

  const userSb = await createSupabaseServerClient();
  const {
    data: { user },
  } = await userSb.auth.getUser();
  if (!user) return new Response("unauthorized", { status: 401 });

  const sb = createSupabaseServiceClient();

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
