/**
 * POST /api/activity/resume — clear an active pause. See pause/route.ts.
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

  const supabase = createSupabaseServiceClient();
  const { error } = await supabase
    .from("activity_settings")
    .upsert(
      {
        user_id: userId,
        paused_until: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ paused: false });
}
