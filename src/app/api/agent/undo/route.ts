import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { applyUndo } from "@/lib/agent/undo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({ token: z.string().uuid() });

/**
 * POST /api/agent/undo — apply the reverse op for an agent_actions
 * row. Session-authed; the user_id comes from the cookie so a stolen
 * token can't be applied across users. Enforces the 30s expiry
 * server-side (the strip's countdown is purely cosmetic).
 */
export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }
  const raw = await req.json().catch(() => ({}));
  const parsed = body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid token." },
      { status: 400 }
    );
  }
  const result = await applyUndo({
    userId: userData.user.id,
    actionId: parsed.data.token,
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
