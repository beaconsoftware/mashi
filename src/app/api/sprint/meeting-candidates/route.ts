import { NextRequest, NextResponse } from "next/server";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";
import { findCandidateMeetings } from "@/lib/sprint/meeting-match";
import type { S2DItem } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/sprint/meeting-candidates?itemId=…
 *
 * Returns the top calendar-event candidates the MeetingPrepCanvas will
 * show in its picker. Scored by token+attendee overlap with the
 * s2d_item, capped at 8. Scope: caller's user_id only.
 */
export async function GET(req: NextRequest) {
  const itemId = req.nextUrl.searchParams.get("itemId");
  if (!itemId) {
    return NextResponse.json({ error: "itemId required" }, { status: 400 });
  }

  const userSb = await createSupabaseServerClient();
  const {
    data: { user },
  } = await userSb.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sb = createSupabaseServiceClient();
  const { data: row, error } = await sb
    .from("s2d_items")
    .select(
      "id, title, description, source_type, source_thread_id, company:companies(*)"
    )
    .eq("user_id", user.id)
    .eq("id", itemId)
    .single();
  if (error || !row) {
    return NextResponse.json({ error: "item not found" }, { status: 404 });
  }
  const item = row as unknown as Pick<
    S2DItem,
    "id" | "title" | "description" | "source_type" | "source_thread_id" | "company"
  >;

  const meetings = await findCandidateMeetings({
    sb,
    userId: user.id,
    item,
    limit: 8,
  });
  return NextResponse.json({ meetings });
}
