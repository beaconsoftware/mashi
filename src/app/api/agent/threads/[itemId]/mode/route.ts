import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";
import { getOrCreateThreadForItem } from "@/lib/agent/threads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH /api/agent/threads/[itemId]/mode
 *
 * Quality Phase 3: flip the per-thread plan/act mode. Resolves (or
 * creates) the item-bound thread, then writes agent_threads.mode under
 * the service role. RLS bypass is intentional — we've already
 * authenticated the caller and we always scope by the resolved
 * user_id, per AGENTS.md multi-tenancy invariants.
 *
 * Body: { mode: "plan" | "act" }
 * Returns: { mode } on success, 400 on bad body, 401 unauth, 500 on write fail.
 */

const bodySchema = z.object({
  mode: z.enum(["plan", "act"]),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ itemId: string }> }
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

  const { itemId } = await params;
  const userId = userData.user.id;
  const service = createSupabaseServiceClient();

  // Resolve (or create) the thread before flipping its mode so the
  // toggle works even on items the user hasn't sent a message to yet.
  const thread = await getOrCreateThreadForItem({
    userId,
    itemId,
    supabase: service,
  });

  const upd = await service
    .from("agent_threads")
    .update({ mode: parsed.data.mode })
    .eq("user_id", userId)
    .eq("id", thread.id);

  if (upd.error) {
    return NextResponse.json(
      { error: upd.error.message },
      { status: 500 }
    );
  }
  return NextResponse.json({ mode: parsed.data.mode });
}
