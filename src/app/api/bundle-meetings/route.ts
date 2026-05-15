import { NextResponse } from "next/server";
import { bundleSameMeetingActionItems } from "@/lib/triage/bundle-meeting-items";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/bundle-meetings
 *
 * Bundles same-meeting Fireflies action items into one canonical S2D per
 * initiative. Runs as part of the auto-sync chain after reconcile and
 * consolidate.
 */
export async function POST() {
  try {
    const r = await bundleSameMeetingActionItems();
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "bundle failed" },
      { status: 500 }
    );
  }
}
