import { NextRequest, NextResponse } from "next/server";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";
import type { EnrichSourceKind } from "@/hooks/use-enriched-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/s2d/:id/decision
 *
 * Records a full DecisionLog on the item and (for yes-but) spawns a
 * follow-up s2d_item carrying the condition forward.
 *
 * Replaces /api/s2d/:id/decide for the Phase-2 DecideCanvas. The older
 * /decide route stays for the legacy tabs path until Phase 4 deletes
 * sprint-card-workspace.
 */

type Choice = "yes" | "yes-but" | "no" | "defer";

interface ReqBody {
  choice: Choice;
  note: string;
  condition?: string;
  deferUntil?: string;
  deferTrigger?: string;
  sourcesCited?: Array<{ kind: EnrichSourceKind; ref: string; label: string }>;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Partial<ReqBody>;
  const choice = body.choice;
  const note = (body.note ?? "").trim();

  if (!choice || !["yes", "yes-but", "no", "defer"].includes(choice)) {
    return NextResponse.json({ error: "valid choice required" }, { status: 400 });
  }
  if (!note) {
    return NextResponse.json({ error: "note required" }, { status: 400 });
  }
  if (choice === "yes-but" && !(body.condition ?? "").trim()) {
    return NextResponse.json(
      { error: "yes-but requires a condition" },
      { status: 400 }
    );
  }
  if (choice === "defer" && !body.deferUntil) {
    return NextResponse.json(
      { error: "defer requires deferUntil" },
      { status: 400 }
    );
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
    .select("id, title, company_id, source_type")
    .eq("user_id", user.id)
    .eq("id", id)
    .single();
  if (itemErr || !item) {
    return NextResponse.json({ error: "item not found" }, { status: 404 });
  }

  const now = new Date().toISOString();
  const condition = body.condition?.trim();
  const sourcesCited = body.sourcesCited ?? [];

  let followUpItemId: string | undefined;

  if (choice === "yes-but" && condition) {
    const ticketSlug = item.title
      .slice(0, 40)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const { data: newRow, error: fuErr } = await sb
      .from("s2d_items")
      .insert({
        user_id: user.id,
        title: condition.slice(0, 200),
        description: `Yes-but follow-up from decision on "${item.title.slice(0, 80)}". Condition: ${condition}`,
        status: "in_queue",
        queue_reason: `Yes-but condition from decision on MASH item`,
        needs_review: false,
        pathway: "watching",
        priority: "medium",
        company_id: item.company_id ?? null,
        source_type: "manual",
        source_id: `decision:${item.id}:${ticketSlug || Date.now()}`,
        spawned_from_item_id: item.id,
        spawn_reason: "decision-yes-but",
      })
      .select("id")
      .single();
    if (!fuErr && newRow?.id) {
      followUpItemId = newRow.id;
    }
  }

  const decisionLog = {
    choice,
    note,
    ...(choice === "yes-but" && condition ? { condition } : {}),
    ...(choice === "defer" && body.deferUntil
      ? { deferUntil: body.deferUntil }
      : {}),
    ...(choice === "defer" && body.deferTrigger
      ? { deferTrigger: body.deferTrigger }
      : {}),
    ...(followUpItemId ? { followUpItemId } : {}),
    sourcesCited,
    decidedAt: now,
  };

  const summary = note.length > 120 ? `${note.slice(0, 117)}…` : note;
  const itemUpdate: Record<string, unknown> = {
    decision_log: decisionLog,
    decision_note: note,
    decision_at: now,
    has_unseen_updates: true,
    last_update_summary: `Decision recorded (${choice}): ${summary}`,
    last_update_at: now,
  };

  // Defer = item stays open, snoozes to the chosen date. Others close.
  if (choice === "defer" && body.deferUntil) {
    itemUpdate.snoozed_until = new Date(
      `${body.deferUntil}T00:00:00`
    ).toISOString();
    itemUpdate.status = "in_queue";
    itemUpdate.queue_reason = `Deferred via decision: ${
      body.deferTrigger ?? "until " + body.deferUntil
    }`;
  } else {
    itemUpdate.status = "done";
    itemUpdate.done_at = now;
    itemUpdate.outcome = `Decided ${choice}: ${summary}`;
    itemUpdate.resolved_via = `decision:${choice}`;
  }

  const { error: updateErr } = await sb
    .from("s2d_items")
    .update(itemUpdate)
    .eq("user_id", user.id)
    .eq("id", item.id);
  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, followUpItemId, decisionLog });
}
