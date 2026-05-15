import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { reconcileAllStatuses } from "@/lib/triage/reconcile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/onboard/cleanup
 *
 * One-time, idempotent cleanup pass run during Step 5 of onboarding.
 *
 * Runs the standard reconcileAllStatuses (which already uses ~30-day
 * cutoffs for stale-but-not-dead-yet items) and stamps
 * user_profile.onboarding_cleanup_ran_at so it can't accidentally
 * re-fire later.
 *
 * A new user's first sync pulls historical data spanning months/years.
 * Without this pass, the cockpit opens with a wall of "open" rows from
 * 2-year-old Fireflies meetings and dead Linear backlogs. The pass
 * closes them with outcome `Auto-closed: ...` so they show up in done
 * but don't clutter the active board.
 *
 * Idempotency: if onboarding_cleanup_ran_at is already set, returns
 * `{ ok: true, skipped: true }` without running. The endpoint is safe
 * to retry on network errors.
 */
export async function POST() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: profile, error: readErr } = await supabase
    .from("user_profile")
    .select("onboarding_cleanup_ran_at")
    .eq("user_id", user.id)
    .maybeSingle();

  // Migration not applied yet — run cleanup anyway, just skip the stamp.
  const migrationPending = !!readErr && /could not find|does not exist/i.test(readErr.message);

  if (!migrationPending && profile?.onboarding_cleanup_ran_at) {
    return NextResponse.json({ ok: true, skipped: true, reason: "already_ran" });
  }

  let result;
  try {
    result = await reconcileAllStatuses();
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "cleanup failed",
      },
      { status: 500 }
    );
  }

  if (!migrationPending) {
    await supabase
      .from("user_profile")
      .update({ onboarding_cleanup_ran_at: new Date().toISOString() })
      .eq("user_id", user.id);
  }

  return NextResponse.json({
    ok: true,
    ...(migrationPending && { warning: "migration_pending" }),
    ...result,
  });
}
