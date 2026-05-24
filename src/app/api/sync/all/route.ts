import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { syncLinearConnection } from "@/lib/sync/linear-sync";
import { syncGmailConnection } from "@/lib/sync/gmail-sync";
import { syncGCalConnection } from "@/lib/sync/gcal-sync";
import { syncSlackConnection } from "@/lib/sync/slack-sync";
import { syncFirefliesConnection } from "@/lib/sync/fireflies-sync";
import { parallelMap } from "@/lib/utils/parallel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CONCURRENCY = 5;

const SUPPORTED_PROVIDERS = new Set([
  "linear",
  "gmail",
  "gcal",
  "slack",
  "fireflies",
]);

function runProviderSync(
  provider: string,
  connectionId: string
): Promise<unknown> | null {
  switch (provider) {
    case "linear":
      return syncLinearConnection(connectionId);
    case "gmail":
      return syncGmailConnection(connectionId);
    case "gcal":
      return syncGCalConnection(connectionId);
    case "slack":
      return syncSlackConnection(connectionId);
    case "fireflies":
      return syncFirefliesConnection(connectionId);
    default:
      return null;
  }
}

/**
 * POST /api/sync/all — fan out per-connection sync across every eligible
 * connected account. Called by the Vercel cron (see vercel.json) on a
 * 15-minute cadence; can also be hit manually with a valid CRON_SECRET for
 * debugging.
 *
 * Authentication: Vercel cron sends `Authorization: Bearer <CRON_SECRET>`.
 * If CRON_SECRET is unset we refuse to run rather than exposing a
 * service-role endpoint to the world. There is intentionally no user-session
 * fallback — manual user-triggered "Sync all" still goes through the
 * per-connection routes via runSyncAll in sync-store.ts.
 */
export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET || "";
  if (!cronSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 503 }
    );
  }
  const authHeader = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${cronSecret}`;
  if (authHeader !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createSupabaseServiceClient();
  const { data: rows, error } = await supabase
    .from("connected_accounts")
    .select("id, provider, last_sync_status, expires_at");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const nowMs = Date.now();
  const eligible: Array<{ id: string; provider: string }> = [];
  let skippedReauth = 0;
  let skippedExpired = 0;
  let skippedUnsupported = 0;

  for (const row of rows ?? []) {
    if (row.last_sync_status === "needs_reauth") {
      skippedReauth++;
      continue;
    }
    if (row.expires_at && new Date(row.expires_at).getTime() < nowMs) {
      // Refresh flow runs lazily inside per-provider syncs, but an already-
      // expired access token with no refresh path will just fail — skip
      // proactively so the cron doesn't pile up noisy failures.
      skippedExpired++;
      continue;
    }
    if (!SUPPORTED_PROVIDERS.has(row.provider)) {
      // Providers we don't dispatch yet (e.g. outlook, mscal, spotify).
      skippedUnsupported++;
      continue;
    }
    eligible.push({ id: row.id, provider: row.provider });
  }

  let ok = 0;
  let errors = 0;
  const errorDetails: Array<{ id: string; provider: string; error: string }> = [];

  await parallelMap(eligible, CONCURRENCY, async (conn) => {
    try {
      const p = runProviderSync(conn.provider, conn.id);
      if (!p) return;
      await p;
      ok++;
    } catch (err) {
      errors++;
      const msg = err instanceof Error ? err.message : String(err);
      errorDetails.push({ id: conn.id, provider: conn.provider, error: msg });
      // Per-connection sync functions already record their own failure into
      // connected_accounts.last_sync_error via recordSyncFailure — we just
      // need to not abort the rest of the batch.
      console.warn(`[sync/all] ${conn.provider}/${conn.id} failed:`, msg);
    }
  });

  return NextResponse.json({
    ok,
    errors,
    skipped_reauth: skippedReauth,
    skipped_expired: skippedExpired,
    skipped_unsupported: skippedUnsupported,
    total_eligible: eligible.length,
    error_details: errorDetails,
  });
}
