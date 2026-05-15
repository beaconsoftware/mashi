import { NextRequest, NextResponse } from "next/server";
import { syncLinearConnection } from "@/lib/sync/linear-sync";
import { syncGmailConnection } from "@/lib/sync/gmail-sync";
import { syncGCalConnection } from "@/lib/sync/gcal-sync";
import { syncSlackConnection } from "@/lib/sync/slack-sync";
import { syncFirefliesConnection } from "@/lib/sync/fireflies-sync";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/sync/:provider/:connectionId  — run an immediate sync
 *
 * As we add Gmail / Slack / etc., dispatch to the right sync function here.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ provider: string; connectionId: string }> }
) {
  const { provider, connectionId } = await params;

  // Ownership check — RLS handles this on read but we do a defensive check
  // to fail fast with a clearer error before touching providers.
  const supabase = await createSupabaseServerClient();
  const { data: conn, error } = await supabase
    .from("connected_accounts")
    .select("id, provider")
    .eq("id", connectionId)
    .maybeSingle();
  if (error || !conn) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }
  if (conn.provider !== provider) {
    return NextResponse.json({ error: "Provider mismatch" }, { status: 400 });
  }

  try {
    if (provider === "linear") {
      const result = await syncLinearConnection(connectionId);
      return NextResponse.json({ ok: true, ...result });
    }
    if (provider === "gmail") {
      const result = await syncGmailConnection(connectionId);
      return NextResponse.json({ ok: true, ...result });
    }
    if (provider === "gcal") {
      const result = await syncGCalConnection(connectionId);
      return NextResponse.json({ ok: true, ...result });
    }
    if (provider === "slack") {
      const result = await syncSlackConnection(connectionId);
      return NextResponse.json({ ok: true, ...result });
    }
    if (provider === "fireflies") {
      const result = await syncFirefliesConnection(connectionId);
      return NextResponse.json({ ok: true, ...result });
    }
    return NextResponse.json(
      { error: `Sync not implemented yet for ${provider}` },
      { status: 501 }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Sync failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
