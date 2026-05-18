import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { pushS2DStatusToLinear } from "@/lib/sync/linear-pushback";
import type { S2DItem, S2DStatus } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH /api/s2d/:id
 *
 * Centralized S2D mutation endpoint. Updates the row in Supabase, then —
 * if the item came from Linear and its status changed — pushes the status
 * change back to Linear so external state matches your board.
 *
 * The Supabase write happens first; the Linear sync-back is best-effort
 * (failures get logged but don't roll back the local change). That way
 * Mashi never gets stuck unable to update its own board because of an
 * external API hiccup.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const patch = (await req.json()) as Partial<S2DItem>;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  // Pre-read so we know the previous status (for sync-back decision).
  // Session client + RLS scopes this lookup to the caller.
  const { data: before } = await supabase
    .from("s2d_items")
    .select("status, source_type")
    .eq("id", id)
    .single();

  // Strip joined fields
  const { company: _company, ...writable } = patch as Partial<S2DItem> & {
    company?: unknown;
  };
  void _company;

  // Auto-stamp done_at when transitioning to done
  if (writable.status === "done" && before?.status !== "done") {
    (writable as Record<string, unknown>).done_at = new Date().toISOString();
  }
  // Clear done_at if moving out of done
  if (writable.status && writable.status !== "done" && before?.status === "done") {
    (writable as Record<string, unknown>).done_at = null;
  }

  const { error } = await supabase
    .from("s2d_items")
    .update(writable)
    .eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Linear sync-back (best effort)
  let syncBack: { ok: boolean; message: string } | null = null;
  if (
    before?.source_type === "linear" &&
    writable.status &&
    writable.status !== before.status
  ) {
    try {
      syncBack = await pushS2DStatusToLinear({
        s2dItemId: id,
        newStatus: writable.status as S2DStatus,
        userId: user.id,
      });
    } catch (err) {
      syncBack = {
        ok: false,
        message: err instanceof Error ? err.message : "linear push failed",
      };
    }
  }

  return NextResponse.json({ ok: true, syncBack });
}
