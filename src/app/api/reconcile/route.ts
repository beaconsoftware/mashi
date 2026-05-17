import { NextResponse } from "next/server";
import { reconcileAllStatuses } from "@/lib/triage/reconcile";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/reconcile
 *
 * Per-user reconciliation pass — closes the caller's S2D items whose
 * underlying source has clearly moved on (Linear completed/cancelled,
 * Gmail/Slack replied, etc).
 */
export async function POST() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  try {
    const r = await reconcileAllStatuses(user.id);
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "reconcile failed" },
      { status: 500 }
    );
  }
}
