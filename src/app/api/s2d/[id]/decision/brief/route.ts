import { NextRequest, NextResponse } from "next/server";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";
import { generateDecisionBrief } from "@/lib/anthropic/decide-brief";
import type { EnrichSourceKind } from "@/hooks/use-enriched-context";
import type { S2DItem } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface EnrichedSource {
  kind: EnrichSourceKind;
  ref: string;
  label: string;
  snippet?: string;
}

interface StoredEnrichedContext {
  pulled_sources?: EnrichedSource[];
  decision_brief?: unknown;
}

/**
 * POST /api/s2d/:id/decision/brief
 *
 * On-demand 4-option brief generator for the DecideCanvas. Reads any
 * pulled_sources from enriched_context (so refine before briefing is
 * worth it), runs the Claude call, and writes the result back into
 * enriched_context.decision_brief.
 *
 * Contract-card pre-warm in Phase 5 will call the same library
 * directly; this route is the manual fallback / opt-out-but-changed-
 * my-mind path.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const userSb = await createSupabaseServerClient();
  const {
    data: { user },
  } = await userSb.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sb = createSupabaseServiceClient();

  const { data: row, error } = await sb
    .from("s2d_items")
    .select("*, company:companies(*), enriched_context")
    .eq("user_id", user.id)
    .eq("id", id)
    .single();
  if (error || !row) {
    return NextResponse.json({ error: "item not found" }, { status: 404 });
  }
  const item = row as S2DItem & { enriched_context?: StoredEnrichedContext };
  if (item.pathway !== "decision_gate") {
    return NextResponse.json(
      { error: "brief only valid for decision_gate items" },
      { status: 400 }
    );
  }

  const enriched: StoredEnrichedContext = item.enriched_context ?? {};
  const pulled = enriched.pulled_sources ?? [];
  const sources = pulled.map((s) => ({
    kind: s.kind,
    ref: s.ref,
    label: s.label,
    snippet: (s.snippet ?? "").slice(0, 800),
  }));

  let brief;
  try {
    brief = await generateDecisionBrief({ item, sources, userId: user.id });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "brief failed" },
      { status: 500 }
    );
  }

  const merged: StoredEnrichedContext = {
    ...enriched,
    decision_brief: brief,
  };

  const { error: upErr } = await sb
    .from("s2d_items")
    .update({ enriched_context: merged })
    .eq("user_id", user.id)
    .eq("id", item.id);
  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, brief });
}
