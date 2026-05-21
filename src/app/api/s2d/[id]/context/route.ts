import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveItemContext } from "@/lib/s2d/context-resolver";
import type { S2DItem } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/s2d/:id/context
 *
 * Pull every signal Mashi has about a work unit and return it as one
 * consolidated bundle. Used by the detail-sheet "Context" panel and the
 * "Copy as Claude prompt" button.
 *
 * Resolution logic lives in src/lib/s2d/context-resolver.ts so the brief
 * consolidator and any other server-side caller can share the exact same
 * code path without making an internal HTTP hop.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: item, error: itemErr } = await supabase
    .from("s2d_items")
    .select("*")
    .eq("id", id)
    .single();
  if (itemErr || !item) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  const ctx = await resolveItemContext(supabase, item as S2DItem);
  return NextResponse.json(ctx);
}
