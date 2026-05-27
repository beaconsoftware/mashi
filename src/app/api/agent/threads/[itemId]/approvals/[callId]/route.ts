import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";
import { recordApprovalDecision } from "@/lib/agent/approval";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/agent/threads/[itemId]/approvals/[callId]
 *
 * Records the user's Approve / Edit / Cancel decision on a pending
 * ring-3 (write_world) tool call. The streaming agent loop is polling
 * `agent_approvals` for a status flip; this endpoint flips it.
 *
 * Body:
 *   { decision: "approve" | "edit" | "cancel", edited_args?: unknown }
 *
 * Item-bound twin of /by-id/[threadId]/approvals/[callId]. Both resolve
 * the thread and call `recordApprovalDecision` — the only difference is
 * the URL shape callers can use.
 */

const bodySchema = z.object({
  decision: z.enum(["approve", "edit", "cancel"]),
  edited_args: z.unknown().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ itemId: string; callId: string }> }
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

  const { itemId, callId } = await params;

  const sb = createSupabaseServiceClient();
  const { data: thread } = await sb
    .from("agent_threads")
    .select("id")
    .eq("user_id", userId)
    .eq("item_id", itemId)
    .maybeSingle();
  if (!thread) {
    return NextResponse.json({ error: "thread not found" }, { status: 404 });
  }

  const result = await recordApprovalDecision({
    userId,
    threadId: thread.id,
    callId,
    decision: parsed.data.decision,
    editedArgs: parsed.data.edited_args,
    supabase: sb,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
