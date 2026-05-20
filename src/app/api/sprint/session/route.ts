import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PlannedItem {
  s2d_item_id: string;
  title?: string | null;
  pathway?: string | null;
  priority?: string | null;
  est_minutes?: number | null;
}
interface ResultItem {
  s2d_item_id: string;
  status: "done" | "skipped";
  actual_min: number;
}

interface CompleteBody {
  started_at: string;
  completed_at: string;
  planned_items: PlannedItem[];
  results: ResultItem[];
  theme?: string | null;
  notes?: string | null;
}

/**
 * POST  /api/sprint/session  — persist a finished sprint as a row in
 *   sprint_sessions for performance tracking. Called from sprint-complete.tsx
 *   when the user clicks "Save & …". Session-authed: user_id comes from
 *   the Supabase session, not from the request body, so a stolen body
 *   can't write to another user.
 *
 * GET   /api/sprint/session?limit=N  — return the caller's most recent
 *   sessions ordered by started_at desc.
 */
export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const body = (await req.json()) as CompleteBody;
  if (!body.started_at || !body.completed_at) {
    return NextResponse.json({ error: "started_at and completed_at required" }, { status: 400 });
  }

  const planned = Array.isArray(body.planned_items) ? body.planned_items : [];
  const results = Array.isArray(body.results) ? body.results : [];
  const doneCount = results.filter((r) => r.status === "done").length;
  const skippedCount = results.filter((r) => r.status === "skipped").length;
  const totalPlannedMin = planned.reduce(
    (sum, p) => sum + (typeof p.est_minutes === "number" ? p.est_minutes : 0),
    0
  );
  const totalActualMin = results.reduce((sum, r) => sum + (r.actual_min || 0), 0);

  const { data, error } = await supabase
    .from("sprint_sessions")
    .insert({
      user_id: user.id, // explicit — service-role bypasses default auth.uid()
      started_at: body.started_at,
      completed_at: body.completed_at,
      planned_items: planned,
      results,
      planned_count: planned.length,
      done_count: doneCount,
      skipped_count: skippedCount,
      total_planned_min: totalPlannedMin,
      total_actual_min: totalActualMin,
      theme: body.theme ?? null,
      notes: body.notes ?? null,
    })
    .select("id")
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: data.id });
}

export async function GET(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const limit = Math.min(
    50,
    Math.max(1, parseInt(req.nextUrl.searchParams.get("limit") ?? "10", 10) || 10)
  );

  const { data, error } = await supabase
    .from("sprint_sessions")
    .select(
      "id, started_at, completed_at, planned_count, done_count, skipped_count, total_planned_min, total_actual_min, theme"
    )
    .eq("user_id", user.id)
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Pre-compute aggregate stats so the client doesn't have to.
  const rows = data ?? [];
  const totalSessions = rows.length;
  const totalDone = rows.reduce((s, r) => s + r.done_count, 0);
  const totalPlanned = rows.reduce((s, r) => s + r.planned_count, 0);
  const totalFocusMin = rows.reduce((s, r) => s + r.total_actual_min, 0);
  const completionRate = totalPlanned > 0 ? totalDone / totalPlanned : null;

  return NextResponse.json({
    sessions: rows,
    aggregate: {
      total_sessions: totalSessions,
      total_done: totalDone,
      total_planned: totalPlanned,
      completion_rate: completionRate,
      total_focus_min: totalFocusMin,
    },
  });
}
