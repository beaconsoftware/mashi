import { NextResponse } from "next/server";
import { consolidateDuplicates } from "@/lib/triage/consolidate";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/consolidate
 *
 * Per-user pass — clusters duplicate s2d_items within the caller's own
 * companies and merges each cluster into a canonical row.
 */
export async function POST() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  try {
    const r = await consolidateDuplicates(user.id);
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "consolidate failed" },
      { status: 500 }
    );
  }
}
