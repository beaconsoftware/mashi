import { NextRequest, NextResponse } from "next/server";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";
import { generateHeadsDownPlan } from "@/lib/anthropic/heads-down-plan";
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
  pinned?: boolean;
}

interface StoredEnrichedContext {
  pulled_sources?: EnrichedSource[];
  heads_down_plan?: unknown;
}

/**
 * POST /api/s2d/:id/heads-down/plan
 *
 * On-demand 3-step plan + handoff prompt generator for the HeadsDown
 * canvas. Reads any pulled_sources from enriched_context so refining
 * before generating tightens the prompt, runs the Claude call, and
 * writes the result back into enriched_context.heads_down_plan.
 *
 * Contract-card pre-warm in Phase 5 will call generateHeadsDownPlan()
 * directly; this route is the manual fallback for slots that activate
 * before the pre-warm completes.
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
  if (item.pathway !== "heads_down") {
    return NextResponse.json(
      { error: "plan only valid for heads_down items" },
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
    pinned: !!s.pinned,
  }));

  let plan;
  try {
    plan = await generateHeadsDownPlan({ item, sources, userId: user.id });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "plan failed" },
      { status: 500 }
    );
  }

  const merged: StoredEnrichedContext = {
    ...enriched,
    heads_down_plan: plan,
  };

  const { error: upErr } = await sb
    .from("s2d_items")
    .update({ enriched_context: merged })
    .eq("user_id", user.id)
    .eq("id", item.id);
  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, plan });
}
