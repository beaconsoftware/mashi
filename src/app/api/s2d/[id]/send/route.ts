import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { sendGmailReply } from "@/lib/send/gmail-send";
import { sendSlackReply } from "@/lib/send/slack-send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface SendBody {
  body: string;
}

/**
 * POST /api/s2d/:id/send
 *
 * Sends the draft via the right provider based on the item's source_type.
 * Marks the item done on success. This is the action behind the Approval
 * Card's "Approve" button.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { body } = (await req.json()) as SendBody;

  if (!body || body.trim().length === 0) {
    return NextResponse.json({ error: "body required" }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  // Session client + RLS already scopes this lookup to the caller — but we
  // also thread userId into the send helpers so their service-role queries
  // re-enforce it. Belt and suspenders.
  const { data: item, error } = await supabase
    .from("s2d_items")
    .select("source_type")
    .eq("id", id)
    .single();
  if (error || !item) {
    return NextResponse.json({ error: "item not found" }, { status: 404 });
  }

  try {
    if (item.source_type === "gmail") {
      const r = await sendGmailReply({ s2dItemId: id, body, userId: user.id });
      if (!r.ok) return NextResponse.json({ error: r.message }, { status: 500 });
      return NextResponse.json({ ok: true, channel: "gmail", message: r.message });
    }
    if (item.source_type === "slack") {
      const r = await sendSlackReply({ s2dItemId: id, text: body, userId: user.id });
      if (!r.ok) return NextResponse.json({ error: r.message }, { status: 500 });
      return NextResponse.json({ ok: true, channel: "slack", message: r.message });
    }
    return NextResponse.json(
      { error: `Send not supported for source_type=${item.source_type}` },
      { status: 400 }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "send failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
