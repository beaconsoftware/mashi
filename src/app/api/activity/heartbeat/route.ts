/**
 * POST /api/activity/heartbeat
 *
 * Single ingestion endpoint for all three feeders (Mac helper, browser
 * extension, cloud sync). Each request carries a batch of events; we
 * persist them to activity_events, then run the matcher to produce any
 * activity_suggestions.
 *
 * Auth: Bearer mashi_pat_* with 'activity:write' scope (feeders) OR
 * Supabase session (web app dev/testing).
 *
 * Gating: requires the user to have activity_settings.enabled = true AND
 * paused_until either NULL or in the past. If disabled/paused, the route
 * accepts the payload but discards it (returns ingested=0). This keeps
 * clients dumb — they don't have to query state to know when to send.
 */

import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { authenticateActivity } from "@/lib/activity/auth";
import { runMatcher } from "@/lib/activity/matcher";
import { checkRateLimit } from "@/lib/activity/rate-limit";
import { log } from "@/lib/log";
import type {
  HeartbeatEvent,
  HeartbeatRequest,
  HeartbeatResponse,
  ActivitySource,
} from "@/lib/activity/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_SOURCES: ActivitySource[] = ["mac_helper", "browser_ext", "cloud"];
const VALID_SIGNAL_KINDS = new Set([
  "open",
  "focus",
  "close",
  "merge",
  "archive",
  "idle_end",
]);
const MAX_EVENTS_PER_REQUEST = 100;

function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}

function validateBody(body: unknown):
  | { ok: true; req: HeartbeatRequest }
  | { ok: false; message: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, message: "Body must be a JSON object" };
  }
  const b = body as Record<string, unknown>;

  if (!VALID_SOURCES.includes(b.source as ActivitySource)) {
    return { ok: false, message: `source must be one of ${VALID_SOURCES.join(", ")}` };
  }
  if (typeof b.client_id !== "string" || b.client_id.length === 0) {
    return { ok: false, message: "client_id required" };
  }
  if (!Array.isArray(b.events)) {
    return { ok: false, message: "events must be an array" };
  }
  if (b.events.length === 0) {
    return { ok: false, message: "events array cannot be empty" };
  }
  if (b.events.length > MAX_EVENTS_PER_REQUEST) {
    return {
      ok: false,
      message: `events array exceeds max of ${MAX_EVENTS_PER_REQUEST}`,
    };
  }

  for (const [i, raw] of b.events.entries()) {
    if (!raw || typeof raw !== "object") {
      return { ok: false, message: `events[${i}] must be an object` };
    }
    const e = raw as Record<string, unknown>;
    if (typeof e.surface !== "string") {
      return { ok: false, message: `events[${i}].surface required` };
    }
    if (typeof e.signal_kind !== "string" || !VALID_SIGNAL_KINDS.has(e.signal_kind)) {
      return {
        ok: false,
        message: `events[${i}].signal_kind invalid (must be one of ${[...VALID_SIGNAL_KINDS].join(", ")})`,
      };
    }
    if (typeof e.started_at !== "string" || Number.isNaN(Date.parse(e.started_at))) {
      return { ok: false, message: `events[${i}].started_at must be ISO-8601` };
    }
  }

  return { ok: true, req: b as unknown as HeartbeatRequest };
}

async function isWatcherActive(userId: string): Promise<boolean> {
  const supabase = createSupabaseServiceClient();
  const { data } = await supabase
    .from("activity_settings")
    .select("enabled, paused_until")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return false;
  if (!data.enabled) return false;
  if (data.paused_until && new Date(data.paused_until).getTime() > Date.now()) {
    return false;
  }
  return true;
}

export async function POST(req: Request) {
  const auth = await authenticateActivity(req, { requireWriteScope: true });
  if (!auth.ok) return auth.response;
  const { userId, via, tokenId } = auth;

  if (!(await isWatcherActive(userId))) {
    // Silently drop. The feeder can keep heartbeating; we just don't store.
    return NextResponse.json<HeartbeatResponse>({
      ingested: 0,
      new_suggestions: 0,
    });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Body must be valid JSON");
  }

  const v = validateBody(body);
  if (!v.ok) return badRequest(v.message);
  const { source, client_id, events } = v.req;

  // Rate limit by token, counting events (not requests). Session-auth web
  // app reads skip this — those are low-volume and user-driven.
  if (via === "bearer" && tokenId) {
    const rl = checkRateLimit(tokenId, events.length);
    if (!rl.allowed) {
      return NextResponse.json(
        {
          error: "Rate limit exceeded",
          retry_after_sec: rl.retryAfterSec,
        },
        {
          status: 429,
          headers: { "Retry-After": String(rl.retryAfterSec) },
        }
      );
    }
  }

  const supabase = createSupabaseServiceClient();

  // Service-role insert MUST set user_id explicitly per multi-tenancy
  // invariants in AGENTS.md.
  const rows = events.map((e: HeartbeatEvent) => ({
    user_id: userId,
    source,
    surface: e.surface,
    identifier: e.identifier ?? null,
    title: e.title ? e.title.slice(0, 200) : null,
    app: e.app ?? null,
    url: e.url ?? null,
    signal_kind: e.signal_kind,
    started_at: e.started_at,
    ended_at: e.ended_at ?? null,
    client_id,
  }));

  const { data: inserted, error } = await supabase
    .from("activity_events")
    .insert(rows)
    .select("id");
  if (error) {
    log.error("activity_heartbeat.insert_failed", {
      user_id: userId,
      source,
      row_count: rows.length,
      message: error.message,
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Map input events to their resulting DB ids so the matcher can reference
  // event_ids in suggestion context.
  const eventIdsByInput = new Map<HeartbeatEvent, string>();
  events.forEach((e, idx) => {
    const id = inserted?.[idx]?.id;
    if (id) eventIdsByInput.set(e, id);
  });

  const newSuggestions = await runMatcher({
    userId,
    source,
    eventIdsByInput,
  });

  return NextResponse.json<HeartbeatResponse>({
    ingested: rows.length,
    new_suggestions: newSuggestions,
  });
}
