import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { TOTAL_STEPS } from "@/lib/onboarding/steps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/onboard/step  { step: number }
 *
 * Advances the user's onboarding_step. Won't move backwards. Stamps
 * onboarded_at when the final step (TOTAL_STEPS) is reached.
 */
export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = (await req.json()) as { step?: number };
  const step = Number(body.step);
  if (!Number.isInteger(step) || step < 1 || step > TOTAL_STEPS) {
    return NextResponse.json({ error: "step out of range" }, { status: 400 });
  }

  const { data: profile, error: readErr } = await supabase
    .from("user_profile")
    .select("onboarding_step")
    .eq("user_id", user.id)
    .maybeSingle();

  // If the migration hasn't run yet, the column doesn't exist. Don't fail
  // the client — return ok and let them navigate forward. The dashboard
  // guard will be permissive in the same case.
  if (readErr && isMissingColumn(readErr.message)) {
    return NextResponse.json({ ok: true, step, warning: "migration_pending" });
  }

  const current = profile?.onboarding_step ?? 0;
  if (step < current) {
    return NextResponse.json({ ok: true, step: current });
  }

  // UPSERT not UPDATE: if the create_user_profile_on_signup trigger
  // failed (search_path bug, transient DB error, whatever) the user has
  // an auth.users row but no user_profile row. A plain UPDATE WHERE
  // user_id = X then matches 0 rows, silently returns ok=true, and
  // every click in the wizard "succeeds" without actually persisting —
  // the user gets stuck in a redirect loop because the middleware
  // keeps seeing step=0. Upserting is self-healing.
  const upsertRow: Record<string, unknown> = {
    user_id: user.id,
    email: user.email,
    onboarding_step: step,
  };
  if (step >= TOTAL_STEPS) {
    upsertRow.onboarded_at = new Date().toISOString();
  }

  const { data: written, error } = await supabase
    .from("user_profile")
    .upsert(upsertRow, { onConflict: "user_id" })
    .select("onboarding_step, onboarded_at")
    .single();

  if (error) {
    if (isMissingColumn(error.message)) {
      return NextResponse.json({ ok: true, step, warning: "migration_pending" });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Defensive: if the write didn't actually land what we asked for,
  // surface it so the wizard doesn't silently navigate forward.
  if (written?.onboarding_step !== step) {
    return NextResponse.json(
      {
        error: `onboarding_step write didn't land: expected ${step}, got ${written?.onboarding_step}`,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, step });
}

function isMissingColumn(msg: string): boolean {
  return /could not find the .* column|column .* does not exist/i.test(msg);
}
