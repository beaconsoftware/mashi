import { NextResponse } from "next/server";
import { bundleSameMeetingActionItems } from "@/lib/triage/bundle-meeting-items";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/bundle-meetings
 *
 * Per-user pass — bundles the caller's same-meeting Fireflies action
 * items into one canonical S2D per initiative.
 */
export async function POST() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  try {
    const r = await bundleSameMeetingActionItems(user.id);
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "bundle failed" },
      { status: 500 }
    );
  }
}
