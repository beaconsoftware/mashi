import { NextResponse } from "next/server";
import { reconcileAllStatuses } from "@/lib/triage/reconcile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/reconcile
 *
 * One-time / on-demand status reconciliation. Closes S2D items whose
 * underlying source has clearly moved on:
 *   - Linear: issue is in a completed/cancelled state type
 *   - Gmail/Slack: the user has replied after the S2D item was created
 *     (non-watching pathways only)
 */
export async function POST() {
  try {
    const r = await reconcileAllStatuses();
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "reconcile failed" },
      { status: 500 }
    );
  }
}
