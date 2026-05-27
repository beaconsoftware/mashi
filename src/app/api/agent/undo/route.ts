import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { applyUndo } from "@/lib/agent/undo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/agent/undo
 *
 * Body: { action_id: uuid }
 *
 * Resolves the captured undo_payload on an agent_actions row and
 * applies it, then stamps undone_at. Idempotent — if the action has
 * already been undone, returns { ok: true, already_undone: true }.
 * Returns 410 (Gone) with reason='expired' when the 30s window has
 * lapsed.
 */
const bodySchema = z.object({ action_id: z.string().uuid() });

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "action_id (uuid) is required" },
      { status: 400 }
    );
  }

  try {
    const res = await applyUndo({
      userId: user.id,
      actionId: parsed.data.action_id,
    });

    if (res.ok && res.reason === "already_undone") {
      return NextResponse.json({ ok: true, already_undone: true });
    }
    if (res.ok) {
      return NextResponse.json({ ok: true });
    }
    if (res.reason === "expired") {
      return NextResponse.json(
        {
          ok: false,
          reason: "expired",
          error:
            "This action can no longer be undone, too much time has passed.",
        },
        { status: 410 }
      );
    }
    if (res.reason === "irreversible") {
      return NextResponse.json(
        {
          ok: false,
          reason: "irreversible",
          error: "This action has no undo (external send).",
        },
        { status: 422 }
      );
    }
    if (res.reason === "not_found") {
      return NextResponse.json(
        { ok: false, reason: "not_found", error: "Action not found." },
        { status: 404 }
      );
    }
    return NextResponse.json(
      { ok: false, reason: res.reason ?? "unknown" },
      { status: 400 }
    );
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "undo failed",
      },
      { status: 500 }
    );
  }
}
