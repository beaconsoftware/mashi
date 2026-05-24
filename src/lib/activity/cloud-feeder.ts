/**
 * Cloud feeder — emit activity heartbeats from server-side sync code.
 *
 * Per-provider sync files (linear-sync, gmail-sync, slack-sync) call
 * `emitCloudHeartbeats` after they've observed lifecycle events worth
 * surfacing to the matcher. We bypass the /api/activity/heartbeat HTTP
 * boundary on purpose — the heartbeat route is auth-gated for external
 * clients (Mac helper, browser extension) using `mashi_pat_*` tokens.
 * Server-side syncs run with service role and already know which user
 * they're syncing for, so we go direct.
 *
 * Same opt-in gate as the HTTP endpoint: if the user hasn't enabled
 * the watcher (or has paused it), we silently no-op. This keeps the
 * call sites dumb — they don't have to check the setting themselves,
 * and an enable/disable from settings instantly applies to all sync
 * paths on the next run.
 *
 * Multi-tenancy: every row inserted sets `user_id` explicitly. Service-
 * role bypasses RLS and the DB default `auth.uid()` is NULL under it,
 * so the NOT NULL constraint would reject the write otherwise. See
 * AGENTS.md "Multi-tenancy invariants".
 */

import { randomUUID } from "node:crypto";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { runMatcher } from "./matcher";
import type { HeartbeatEvent } from "./types";

/**
 * Same shape as the `isWatcherActive` check in the heartbeat route, but
 * scoped to server-side callers. Returns true only if the user has
 * explicitly opted in AND isn't currently paused.
 */
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

interface EmitOptions {
  userId: string;
  events: HeartbeatEvent[];
}

interface EmitResult {
  skipped: boolean; // true if watcher inactive — nothing was inserted
  inserted: number;
  newSuggestions: number;
}

/**
 * Persist a batch of cloud-source heartbeats and run the matcher over
 * them. Caller passes pre-validated `HeartbeatEvent` objects; no
 * additional shape validation here.
 *
 * Failures (DB error, matcher error) are logged but do not throw — a
 * broken activity pipeline shouldn't break a sync run.
 */
export async function emitCloudHeartbeats(
  opts: EmitOptions
): Promise<EmitResult> {
  const { userId, events } = opts;
  if (events.length === 0) {
    return { skipped: false, inserted: 0, newSuggestions: 0 };
  }

  if (!(await isWatcherActive(userId))) {
    return { skipped: true, inserted: 0, newSuggestions: 0 };
  }

  // One client_id per emit batch is enough — this column exists to
  // attribute events to a specific feeder instance for debugging.
  // Server-side syncs are stateless across runs, so a fresh UUID per
  // call is fine.
  const clientId = randomUUID();

  const supabase = createSupabaseServiceClient();

  // Service-role insert MUST set user_id explicitly. Default `auth.uid()`
  // resolves to NULL under service role; NOT NULL would reject.
  const rows = events.map((e) => ({
    user_id: userId,
    source: "cloud" as const,
    surface: e.surface,
    identifier: e.identifier ?? null,
    title: e.title ? e.title.slice(0, 200) : null,
    app: e.app ?? null,
    url: e.url ?? null,
    signal_kind: e.signal_kind,
    started_at: e.started_at,
    ended_at: e.ended_at ?? null,
    client_id: clientId,
  }));

  const { data: inserted, error } = await supabase
    .from("activity_events")
    .insert(rows)
    .select("id");
  if (error) {
    console.error("[activity/cloud-feeder] insert failed:", error);
    return { skipped: false, inserted: 0, newSuggestions: 0 };
  }

  // Map each input event to its DB id so the matcher can reference
  // event_ids in suggestion context. Order matches because Supabase
  // returns inserted rows in the order they were sent.
  const eventIdsByInput = new Map<HeartbeatEvent, string>();
  events.forEach((e, idx) => {
    const id = inserted?.[idx]?.id;
    if (id) eventIdsByInput.set(e, id);
  });

  let newSuggestions = 0;
  try {
    newSuggestions = await runMatcher({
      userId,
      source: "cloud",
      eventIdsByInput,
    });
  } catch (err) {
    console.error("[activity/cloud-feeder] matcher failed:", err);
  }

  return { skipped: false, inserted: rows.length, newSuggestions };
}
