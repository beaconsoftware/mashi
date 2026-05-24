/**
 * GET /api/activity/suggestions
 *
 * Returns the active queue of suggestions for the calling user:
 *   - pending  : awaiting decision
 *   - dismissed: marked "view later" within the past 24h
 *
 * Used by the cockpit "Pending suggestions" surface. Web-session auth only —
 * feeders don't need to read suggestions back.
 */

import { NextResponse } from "next/server";
import { authenticateActivity } from "@/lib/activity/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await authenticateActivity(req);
  if (!auth.ok) return auth.response;
  const { userId } = auth;

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("activity_suggestions")
    .select(
      `
        id, proposed_state, status, confidence, signal_kind, context,
        created_at, dismiss_until,
        s2d_item:s2d_items (id, title, status, priority)
      `
    )
    .eq("user_id", userId)
    .in("status", ["pending", "dismissed"])
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const pending = (data ?? []).filter((r) => r.status === "pending");
  const dismissed = (data ?? []).filter((r) => r.status === "dismissed");

  return NextResponse.json({ pending, dismissed });
}
