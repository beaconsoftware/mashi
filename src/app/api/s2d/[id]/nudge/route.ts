import { NextRequest, NextResponse } from "next/server";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";
import { sendGmailReply } from "@/lib/send/gmail-send";
import { sendSlackReply } from "@/lib/send/slack-send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/s2d/:id/nudge
 *
 * Sends a nudge to the delegate on a `delegated` item. Crucially:
 *
 *   - Does NOT mark the item done. A nudge is a poke, not a resolution
 *     — the slot timer keeps running and the user stays in the slot.
 *   - Routes via the same Gmail / Slack helpers as /api/s2d/:id/send,
 *     but reuses the existing source thread so the nudge lands on the
 *     conversation the delegate already knows about.
 *   - Captures the nudge as a last_update_summary line so the board
 *     and recap show "nudged delegate" with the timestamp.
 *
 * Body shape: { body: string, channel?: 'gmail' | 'slack' }
 *   - `body` is the nudge text. Required.
 *   - `channel` overrides the auto-pick (item.source_type). Optional.
 */

interface NudgeBody {
  body?: string;
  channel?: "gmail" | "slack";
  tone?: "gentle" | "direct" | "escalate";
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const raw = (await req.json().catch(() => ({}))) as NudgeBody;
  const body = (raw.body ?? "").trim();
  if (!body) {
    return NextResponse.json({ error: "body required" }, { status: 400 });
  }

  const userSb = await createSupabaseServerClient();
  const {
    data: { user },
  } = await userSb.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sb = createSupabaseServiceClient();
  const { data: item, error: itemErr } = await sb
    .from("s2d_items")
    .select("id, source_type, pathway, delegated_to, title")
    .eq("user_id", user.id)
    .eq("id", id)
    .single();
  if (itemErr || !item) {
    return NextResponse.json({ error: "item not found" }, { status: 404 });
  }

  const channel: "gmail" | "slack" =
    raw.channel ??
    (item.source_type === "gmail"
      ? "gmail"
      : item.source_type === "slack"
        ? "slack"
        : "gmail");

  try {
    if (channel === "gmail") {
      const r = await sendGmailReply({
        s2dItemId: id,
        body,
        userId: user.id,
      });
      if (!r.ok) {
        return NextResponse.json({ error: r.message }, { status: 500 });
      }
    } else {
      const r = await sendSlackReply({
        s2dItemId: id,
        text: body,
        userId: user.id,
      });
      if (!r.ok) {
        return NextResponse.json({ error: r.message }, { status: 500 });
      }
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "nudge failed" },
      { status: 500 }
    );
  }

  // Critically: the send helpers may flip status=done. Restore in_progress
  // because a nudge isn't a slot exit; the user keeps working on this slot.
  const now = new Date().toISOString();
  const toneSuffix = raw.tone ? ` (${raw.tone})` : "";
  await sb
    .from("s2d_items")
    .update({
      status: "in_progress",
      done_at: null,
      outcome: null,
      resolved_via: null,
      last_update_at: now,
      last_update_summary: `Nudged ${item.delegated_to ?? "delegate"} via ${channel}${toneSuffix}`,
      has_unseen_updates: true,
    })
    .eq("user_id", user.id)
    .eq("id", id);

  return NextResponse.json({ ok: true, channel, sentAt: now });
}
