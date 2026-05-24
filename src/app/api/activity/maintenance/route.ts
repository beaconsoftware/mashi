/**
 * GET /api/activity/maintenance — hourly Vercel cron entrypoint.
 *
 * Two janitor jobs (we don't have pg_cron on this Supabase project, so we
 * piggyback on Vercel cron):
 *
 *   1. TTL on raw events: delete activity_events older than 7 days.
 *   2. Expire dismissed suggestions: any activity_suggestions row with
 *      status='dismissed' AND dismiss_until < now() flips to 'expired'.
 *   3. Drop stale pending suggestions: status='pending' for > 7 days flips
 *      to 'expired'. Prevents the queue from growing forever if a user
 *      ignores notifications.
 *
 * Auth: same CRON_SECRET Bearer as /api/sync/all. Method is GET to match
 * Vercel cron's default (see cron fix PR #28).
 */

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const EVENT_TTL_DAYS = 7;
const PENDING_STALE_DAYS = 7;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET || "";
  if (!cronSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 503 }
    );
  }
  const authHeader = req.headers.get("authorization") ?? "";
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createSupabaseServiceClient();
  const now = new Date();

  // 1. TTL raw events
  const ttlCutoff = new Date(
    now.getTime() - EVENT_TTL_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
  const { count: eventsDeleted, error: ttlErr } = await supabase
    .from("activity_events")
    .delete({ count: "exact" })
    .lt("started_at", ttlCutoff);
  if (ttlErr) {
    console.error("[activity/maintenance] TTL delete failed:", ttlErr);
  }

  // 2. Expire dismissed-past-24h
  const { count: dismissedExpired, error: dismErr } = await supabase
    .from("activity_suggestions")
    .update({ status: "expired" }, { count: "exact" })
    .eq("status", "dismissed")
    .lt("dismiss_until", now.toISOString());
  if (dismErr) {
    console.error("[activity/maintenance] dismiss-expire failed:", dismErr);
  }

  // 3. Expire stale pending
  const staleCutoff = new Date(
    now.getTime() - PENDING_STALE_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
  const { count: pendingExpired, error: pendErr } = await supabase
    .from("activity_suggestions")
    .update({ status: "expired" }, { count: "exact" })
    .eq("status", "pending")
    .lt("created_at", staleCutoff);
  if (pendErr) {
    console.error("[activity/maintenance] pending-expire failed:", pendErr);
  }

  return NextResponse.json({
    events_deleted: eventsDeleted ?? 0,
    dismissed_expired: dismissedExpired ?? 0,
    pending_expired: pendingExpired ?? 0,
  });
}
