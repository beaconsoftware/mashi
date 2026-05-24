/**
 * POST /api/activity/suggestions/:id/decide
 *
 * The ONLY path that turns a suggestion into a state change. Three valid
 * decisions:
 *   - confirm: marks suggestion `confirmed`, transitions s2d_item to
 *              the proposed_state (and stamps done_at for done).
 *   - reject:  marks suggestion `rejected`; item untouched.
 *   - dismiss: marks suggestion `dismissed` with dismiss_until = now() + 24h
 *              so it stays visible in the "Pending suggestions" surface.
 *
 * Web-session auth only — a state change should be an explicit human click
 * from the Mashi UI. Feeders never call this.
 */

import { NextResponse } from "next/server";
import { authenticateActivity } from "@/lib/activity/auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { pushS2DStatusToLinear } from "@/lib/sync/linear-pushback";
import { log } from "@/lib/log";
import type { S2DStatus } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// resolved_via tag for items moved by confirming a watcher-generated
// activity suggestion. Joins the existing tags ("manual", "auto_detected",
// "auto_past_meeting") set elsewhere across review-deck, s2d-board, and the
// triage pipeline.
const RESOLVED_VIA_ACTIVITY_CONFIRM = "activity_confirm";

type Decision = "confirm" | "reject" | "dismiss";
const VALID_DECISIONS: Decision[] = ["confirm", "reject", "dismiss"];

const DISMISS_WINDOW_HOURS = 24;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const auth = await authenticateActivity(req);
  if (!auth.ok) return auth.response;
  const { userId } = auth;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON" }, { status: 400 });
  }
  const decision = (body as { decision?: string })?.decision;
  if (!decision || !VALID_DECISIONS.includes(decision as Decision)) {
    return NextResponse.json(
      { error: `decision must be one of ${VALID_DECISIONS.join(", ")}` },
      { status: 400 }
    );
  }

  const supabase = createSupabaseServiceClient();
  const { data: suggestion, error: fetchErr } = await supabase
    .from("activity_suggestions")
    .select("id, user_id, s2d_item_id, proposed_state, status")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (!suggestion) {
    return NextResponse.json({ error: "Suggestion not found" }, { status: 404 });
  }
  if (suggestion.status !== "pending" && suggestion.status !== "dismissed") {
    return NextResponse.json(
      { error: `Suggestion is already ${suggestion.status}` },
      { status: 409 }
    );
  }

  const nowIso = new Date().toISOString();

  if (decision === "confirm") {
    // Transition the s2d_item to proposed_state. Note: we use the service
    // client and explicitly scope by user_id (multi-tenancy invariants).
    // Sets the same provenance + unseen-update fields a manual status
    // change would set, so the notification hub pulses and the row shows
    // a meaningful "Mashi touched this" summary.
    const itemUpdate: Record<string, unknown> = {
      status: suggestion.proposed_state,
      updated_at: nowIso,
      resolved_via: RESOLVED_VIA_ACTIVITY_CONFIRM,
      has_unseen_updates: true,
      last_update_summary: `Moved to ${suggestion.proposed_state} after confirming detected activity`,
      last_update_at: nowIso,
    };
    if (suggestion.proposed_state === "done") {
      itemUpdate.done_at = nowIso;
    }
    const { error: itemErr } = await supabase
      .from("s2d_items")
      .update(itemUpdate)
      .eq("id", suggestion.s2d_item_id)
      .eq("user_id", userId);
    if (itemErr) {
      return NextResponse.json({ error: itemErr.message }, { status: 500 });
    }
  }

  const updateFields: Record<string, unknown> = {
    status:
      decision === "confirm"
        ? "confirmed"
        : decision === "reject"
          ? "rejected"
          : "dismissed",
    decided_at: nowIso,
  };
  if (decision === "dismiss") {
    updateFields.dismiss_until = new Date(
      Date.now() + DISMISS_WINDOW_HOURS * 60 * 60 * 1000
    ).toISOString();
  }

  const { error: sugErr } = await supabase
    .from("activity_suggestions")
    .update(updateFields)
    .eq("id", id)
    .eq("user_id", userId);
  if (sugErr) {
    return NextResponse.json({ error: sugErr.message }, { status: 500 });
  }

  // Mirror the local move to Linear for Linear-sourced items. Fire-and-
  // forget: if Linear is unreachable, the item isn't Linear-sourced, or
  // the workspace lacks a matching state, the function returns
  // { ok: false, message } gracefully — we don't want a Linear blip to
  // fail the user's confirm click. The local move is already committed
  // above; Linear can re-sync from Mashi's state later if needed.
  if (decision === "confirm") {
    try {
      const result = await pushS2DStatusToLinear({
        s2dItemId: suggestion.s2d_item_id,
        newStatus: suggestion.proposed_state as S2DStatus,
        userId,
      });
      if (!result.ok) {
        log.warn("activity_confirm.linear_pushback_skipped", {
          s2dItemId: suggestion.s2d_item_id,
          newStatus: suggestion.proposed_state,
          message: result.message,
        });
      } else {
        log.info("activity_confirm.linear_pushback_ok", {
          s2dItemId: suggestion.s2d_item_id,
          newStatus: suggestion.proposed_state,
          message: result.message,
        });
      }
    } catch (err) {
      log.error("activity_confirm.linear_pushback_failed", {
        s2dItemId: suggestion.s2d_item_id,
        newStatus: suggestion.proposed_state,
        error: err instanceof Error ? err.message : "unknown error",
      });
    }
  }

  return NextResponse.json({ ok: true, decision });
}
