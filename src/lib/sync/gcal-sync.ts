import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getActiveAccessToken } from "@/lib/oauth/flow";
import { runTriageOnUnit, loadExistingForUnit } from "@/lib/triage/orchestrator";
import { parallelMap } from "@/lib/utils/parallel";
import { recordSyncFailure, formatSyncError } from "@/lib/oauth/reauth";

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const LOOKBACK_DAYS = 7;
const LOOKAHEAD_DAYS = 14;

interface GCalEvent {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: Array<{
    email: string;
    displayName?: string;
    responseStatus?: string;
    self?: boolean;
    organizer?: boolean;
    optional?: boolean;
  }>;
  location?: string;
  hangoutLink?: string;
  conferenceData?: {
    entryPoints?: Array<{ entryPointType: string; uri: string }>;
  };
  organizer?: { email?: string; displayName?: string };
  updated?: string;
}

interface EventForTriage {
  title: string;
  start_at: string;
  end_at: string;
  duration_minutes: number;
  description: string | null;
  location: string | null;
  attendees: Array<{ email: string; name: string | null; organizer: boolean }>;
  is_upcoming: boolean;
  hours_until_start: number;
  meeting_url: string | null;
}

/**
 * Google Calendar sync — v1
 *
 * Stores events as before. Then runs the triage agent on UPCOMING events
 * that look like they need preparation work (board meetings, customer calls,
 * 1:1s with action items, etc.). Most calendar entries (recurring syncs,
 * coffee chats, focus blocks) should produce no S2D items.
 *
 * The agent decides — not us. We just feed it the event and the existing
 * open S2D items already tied to this event id.
 */
export async function syncGCalConnection(connectionId: string): Promise<{
  fetched: number;
  upserted: number;
  triaged: number;
  created: number;
  updated: number;
  closed: number;
}> {
  const supabase = createSupabaseServiceClient();

  const { data: conn, error } = await supabase
    .from("connected_accounts")
    .select("id, user_id, company_id, account_email, scopes")
    .eq("id", connectionId)
    .single();
  if (error) throw error;

  const hasCalendarScope = (conn.scopes ?? []).some((s: string) =>
    s.includes("googleapis.com/auth/calendar")
  );
  if (!hasCalendarScope) {
    const msg =
      "Calendar scopes were not granted for this account. Disconnect and reconnect — when the Google consent screen appears, confirm calendar scopes are listed before approving.";
    await supabase
      .from("connected_accounts")
      .update({ last_sync_status: "error", last_sync_error: msg })
      .eq("id", connectionId);
    throw new Error(msg);
  }

  await supabase
    .from("connected_accounts")
    .update({ last_sync_status: "syncing", last_sync_error: null })
    .eq("id", connectionId);

  try {
    const token = await getActiveAccessToken(connectionId);
    const events = await listEvents(token);

    const rows = events
      .filter((e) => e.status !== "cancelled")
      .map((e) => {
        const startIso = e.start.dateTime ?? toIsoFromDate(e.start.date);
        const endIso = e.end.dateTime ?? toIsoFromDate(e.end.date);
        if (!startIso || !endIso) return null;
        return {
          external_id: e.id,
          source: "google" as const,
          user_id: conn.user_id,
          company_id: conn.company_id,
          connected_account_id: conn.id,
          title: e.summary ?? "(no title)",
          description: e.description ?? null,
          start_at: startIso,
          end_at: endIso,
          attendees: (e.attendees ?? []).map((a) => ({
            email: a.email,
            name: a.displayName ?? null,
            response: a.responseStatus ?? null,
            organizer: !!a.organizer,
            self: !!a.self,
          })),
          location: e.location ?? null,
          meeting_url: pickMeetingUrl(e),
        };
      })
      .filter(<T>(v: T | null): v is T => v != null);

    let upserted = 0;
    if (rows.length > 0) {
      const { error: upErr } = await supabase
        .from("calendar_events")
        .upsert(rows, { onConflict: "user_id,external_id" });
      if (upErr) throw upErr;
      upserted = rows.length;
    }

    // Triage upcoming events only — historical events that already happened
    // don't produce prep work.
    const now = Date.now();
    const upcoming = events.filter((e) => {
      if (e.status === "cancelled") return false;
      const startIso = e.start.dateTime ?? toIsoFromDate(e.start.date);
      if (!startIso) return false;
      const startMs = new Date(startIso).getTime();
      return startMs >= now && startMs <= now + LOOKAHEAD_DAYS * 86_400_000;
    });

    const triageResults = await parallelMap(upcoming, 8, async (e) => {
      try {
        const startIso = e.start.dateTime ?? toIsoFromDate(e.start.date);
        const endIso = e.end.dateTime ?? toIsoFromDate(e.end.date);
        if (!startIso || !endIso) return null;
        const startMs = new Date(startIso).getTime();
        const endMs = new Date(endIso).getTime();

        const triageInput: EventForTriage = {
          title: e.summary ?? "(no title)",
          start_at: startIso,
          end_at: endIso,
          duration_minutes: Math.round((endMs - startMs) / 60000),
          description: e.description ?? null,
          location: e.location ?? null,
          attendees: (e.attendees ?? []).map((a) => ({
            email: a.email,
            name: a.displayName ?? null,
            organizer: !!a.organizer,
          })),
          is_upcoming: true,
          hours_until_start: Math.round((startMs - now) / 3_600_000),
          meeting_url: pickMeetingUrl(e),
        };

        const existing_items = await loadExistingForUnit("calendar", e.id, conn.user_id);

        return await runTriageOnUnit({
          userId: conn.user_id,
          connectedAccountId: conn.id,
          unit: {
            source_type: "calendar",
            source_thread_id: e.id,
            source_label: `Calendar · ${e.summary ?? "(no title)"} · ${startIso.slice(
              0,
              10
            )}`,
            // Best-effort meeting URL — could be Meet/Zoom/Webex from the
            // event description. Not an "open this event in Calendar" deep
            // link (we don't capture htmlLink yet) but it's the most useful
            // single-click action for a calendar-sourced item.
            source_url: pickMeetingUrl(e),
            company_id: conn.company_id,
            content: triageInput,
            existing_items,
          },
        });
      } catch (err) {
        console.warn(`[gcal-sync] event triage failed for ${e.id}:`, err);
        return null;
      }
    });

    const triaged = triageResults.filter((r) => r != null).length;
    const created = triageResults.reduce((s, r) => s + (r?.created ?? 0), 0);
    const updated = triageResults.reduce((s, r) => s + (r?.updated ?? 0), 0);
    const closed = triageResults.reduce((s, r) => s + (r?.closed ?? 0), 0);

    await supabase
      .from("connected_accounts")
      .update({
        last_sync_status: "success",
        last_sync_error: null,
        last_synced_at: new Date().toISOString(),
      })
      .eq("id", connectionId);

    return { fetched: events.length, upserted, triaged, created, updated, closed };
  } catch (err) {
    const msg = formatSyncError(err, "Calendar");
    console.error("[sync] Calendar failed", { connectionId, err, msg });
    await recordSyncFailure(connectionId, msg);
    throw err;
  }
}

async function listEvents(token: string): Promise<GCalEvent[]> {
  const now = Date.now();
  const timeMin = new Date(now - LOOKBACK_DAYS * 86_400_000).toISOString();
  const timeMax = new Date(now + LOOKAHEAD_DAYS * 86_400_000).toISOString();

  const out: GCalEvent[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(`${CALENDAR_API}/calendars/primary/events`);
    url.searchParams.set("timeMin", timeMin);
    url.searchParams.set("timeMax", timeMax);
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("maxResults", "250");
    url.searchParams.set("showDeleted", "false");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(`Calendar list failed: ${res.status} ${await res.text()}`);
    }
    const j = (await res.json()) as {
      items?: GCalEvent[];
      nextPageToken?: string;
    };
    if (j.items) out.push(...j.items);
    pageToken = j.nextPageToken;
  } while (pageToken);

  return out;
}

function toIsoFromDate(d?: string): string | null {
  if (!d) return null;
  return new Date(`${d}T00:00:00Z`).toISOString();
}

function pickMeetingUrl(e: GCalEvent): string | null {
  if (e.hangoutLink) return e.hangoutLink;
  const ep = e.conferenceData?.entryPoints?.find(
    (p) => p.entryPointType === "video"
  );
  return ep?.uri ?? null;
}
