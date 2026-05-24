/**
 * POST /api/activity/pause   — silence feeders for N minutes (or indefinitely)
 * POST /api/activity/resume  — undo a pause
 *
 * Both endpoints accept Bearer (so the menubar helper can pause/resume
 * directly without a web session) AND Supabase session (so the web app's
 * Settings → Activity Monitor page can use them).
 *
 * Sister route: see /api/activity/settings for the full upsert shape.
 */

import { NextResponse } from "next/server";
import { authenticateActivity } from "@/lib/activity/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await authenticateActivity(req);
  if (!auth.ok) return auth.response;
  const { userId } = auth;

  let body: { duration_minutes?: number } = {};
  try {
    body = await req.json();
  } catch {
    // Empty body is valid — means "pause indefinitely".
  }

  const pausedUntil =
    typeof body.duration_minutes === "number" && body.duration_minutes > 0
      ? new Date(Date.now() + body.duration_minutes * 60 * 1000).toISOString()
      : new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000).toISOString();
  // "indefinite" is just very-far-future. Avoids a NULL-means-paused
  // ambiguity (NULL already means "not paused" elsewhere).

  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("activity_settings")
    .upsert(
      {
        user_id: userId,
        paused_until: pausedUntil,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ paused: true, resume_at: pausedUntil });
}
