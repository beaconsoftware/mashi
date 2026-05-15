import { NextResponse } from "next/server";
import { consolidateDuplicates } from "@/lib/triage/consolidate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/consolidate
 *
 * One-time pass that clusters duplicate S2D items per company and merges
 * each cluster into a single canonical row. Duplicates get marked done
 * with outcome="Merged into …" and their source signals append to the
 * canonical row's linked_sources array.
 */
export async function POST() {
  try {
    const r = await consolidateDuplicates();
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "consolidate failed" },
      { status: 500 }
    );
  }
}
