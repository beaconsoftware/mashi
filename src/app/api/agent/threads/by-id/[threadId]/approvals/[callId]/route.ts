import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";
import { recordApprovalDecision } from "@/lib/agent/approval";
import { rememberApprovalAsPolicy } from "@/lib/agent/policy-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/agent/threads/by-id/[threadId]/approvals/[callId]
 *
 * Used by orphan threads (Spotlight chats) where there is no itemId in
 * the URL yet. Same shape as the itemId twin.
 */

const bodySchema = z.object({
  decision: z.enum(["approve", "edit", "cancel"]),
  edited_args: z.unknown().optional(),
  /** E1: when approving, also remember this as an always-allow policy for
   * the call's scope. Ignored for ineligible (irreversible-send) tools. */
  remember: z.boolean().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ threadId: string; callId: string }> }
) {
  const userSb = await createSupabaseServerClient();
  const { data: userData, error: userErr } = await userSb.auth.getUser();
  if (userErr || !userData?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const userId = userData.user.id;

  const raw = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues },
      { status: 400 }
    );
  }

  const { threadId, callId } = await params;

  const sb = createSupabaseServiceClient();
  const owned = await sb
    .from("agent_threads")
    .select("id")
    .eq("user_id", userId)
    .eq("id", threadId)
    .maybeSingle();
  if (!owned.data) {
    return NextResponse.json({ error: "thread not found" }, { status: 404 });
  }

  const result = await recordApprovalDecision({
    userId,
    threadId,
    callId,
    decision: parsed.data.decision,
    editedArgs: parsed.data.edited_args,
    supabase: sb,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }
  if (parsed.data.decision === "approve" && parsed.data.remember) {
    await rememberApprovalAsPolicy({
      userId,
      threadId,
      callId,
      supabase: sb,
    }).catch(() => {});
  }
  return NextResponse.json({ ok: true });
}
