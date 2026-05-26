import { NextRequest, NextResponse } from "next/server";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";
import type { Pathway } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/s2d/:id/spawn-follow-up
 *
 * Generic spawn endpoint used by sprint slot exits that need to create
 * a new s2d_item with a back-reference to the originating one. Today's
 * canonical caller is the ReplyCanvas Send action: after a reply is
 * sent, the user opts in (default on) to track a `watching` follow-up
 * queued 48h out so the sprint recap can show whether anyone replied.
 *
 * Phase 5 wires more callers (decision Yes-but already inlines its own
 * spawn in /decision; heads-down "Spawn follow-up" will use this).
 */

interface ReqBody {
  title?: string;
  description?: string;
  pathway?: Pathway;
  queueHours?: number;
  reason?: string;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as ReqBody;

  const userSb = await createSupabaseServerClient();
  const {
    data: { user },
  } = await userSb.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sb = createSupabaseServiceClient();

  const { data: parent, error: parentErr } = await sb
    .from("s2d_items")
    .select("id, title, company_id, source_type")
    .eq("user_id", user.id)
    .eq("id", id)
    .single();
  if (parentErr || !parent) {
    return NextResponse.json({ error: "item not found" }, { status: 404 });
  }

  const pathway: Pathway = body.pathway ?? "watching";
  const reason = body.reason ?? "spawn-follow-up";
  const queueHours = Number.isFinite(body.queueHours)
    ? Math.max(1, Math.round(body.queueHours!))
    : 48;
  const queueUntil = new Date(Date.now() + queueHours * 60 * 60 * 1000).toISOString();
  const titleRaw = (body.title ?? `Follow-up: ${parent.title}`).slice(0, 200);

  const ticketSlug = parent.title
    .slice(0, 40)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  const { data: newRow, error: fuErr } = await sb
    .from("s2d_items")
    .insert({
      user_id: user.id,
      title: titleRaw,
      description:
        body.description ??
        `Spawned from "${parent.title.slice(0, 80)}" (${reason}).`,
      status: "in_queue",
      queue_reason: reason,
      queue_until: queueUntil,
      needs_review: false,
      pathway,
      priority: "medium",
      company_id: parent.company_id ?? null,
      source_type: "manual",
      source_id: `spawn:${parent.id}:${ticketSlug || Date.now()}`,
      spawned_from_item_id: parent.id,
      spawn_reason: reason,
    })
    .select("id")
    .single();

  if (fuErr) {
    return NextResponse.json({ error: fuErr.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, spawnedItemId: newRow?.id });
}
