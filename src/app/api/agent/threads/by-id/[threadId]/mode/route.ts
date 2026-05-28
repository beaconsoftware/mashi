import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH /api/agent/threads/by-id/[threadId]/mode
 *
 * Quality Phase 3 — by-id variant for orphan (Spotlight) threads. Same
 * shape as the item-id-keyed route; 404s on unknown thread ids since
 * orphan threads aren't lazily created here.
 */

const bodySchema = z.object({
  mode: z.enum(["plan", "act"]),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const supabase = await createSupabaseServerClient();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues },
      { status: 400 }
    );
  }

  const { threadId } = await params;
  const userId = userData.user.id;
  const service = createSupabaseServiceClient();

  const owned = await service
    .from("agent_threads")
    .select("id")
    .eq("user_id", userId)
    .eq("id", threadId)
    .maybeSingle();
  if (!owned.data) {
    return NextResponse.json({ error: "Thread not found." }, { status: 404 });
  }

  const upd = await service
    .from("agent_threads")
    .update({ mode: parsed.data.mode })
    .eq("user_id", userId)
    .eq("id", threadId);

  if (upd.error) {
    return NextResponse.json(
      { error: upd.error.message },
      { status: 500 }
    );
  }
  return NextResponse.json({ mode: parsed.data.mode });
}
