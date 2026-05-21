import { NextRequest, NextResponse } from "next/server";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/spotify/settings   → { logging_enabled: boolean }
 * PATCH /api/spotify/settings  body: { logging_enabled: boolean }
 *
 * Per-user toggle. Used by the connections row + the in-sprint
 * "logging on/off" indicator.
 */
export async function GET() {
  const userSb = await createSupabaseServerClient();
  const {
    data: { user },
  } = await userSb.auth.getUser();
  if (!user) return new Response("unauthorized", { status: 401 });

  const sb = createSupabaseServiceClient();
  const { data } = await sb
    .from("user_profile")
    .select("spotify_logging_enabled")
    .eq("user_id", user.id)
    .maybeSingle();
  return NextResponse.json({
    logging_enabled: data?.spotify_logging_enabled ?? true,
  });
}

export async function PATCH(req: NextRequest) {
  const userSb = await createSupabaseServerClient();
  const {
    data: { user },
  } = await userSb.auth.getUser();
  if (!user) return new Response("unauthorized", { status: 401 });

  const body = (await req.json()) as { logging_enabled?: boolean };
  if (typeof body.logging_enabled !== "boolean") {
    return NextResponse.json({ error: "missing_logging_enabled" }, { status: 400 });
  }

  const sb = createSupabaseServiceClient();
  const { error } = await sb
    .from("user_profile")
    .update({ spotify_logging_enabled: body.logging_enabled })
    .eq("user_id", user.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
