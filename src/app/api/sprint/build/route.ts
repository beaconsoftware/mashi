import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";
import { MODELS } from "@/lib/anthropic/client";
import { trackedCreate } from "@/lib/anthropic/tracked";
import { getUserContext } from "@/lib/user-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/sprint/build
 * Body: { durationMin: number, theme?: string, energy?: "low" | "medium" | "high" }
 *
 * Opus takes the user's constraints + the full open-item pool and returns
 * an ordered subset of items that fit the time budget AND match the theme.
 *
 * Why Opus: this is the daily ritual the user actually uses. The cost of
 * a bad picks (wrong items, time budget blown, missed urgency) is high.
 * "Forget cost" applies double here.
 */
interface Body {
  durationMin?: number;
  theme?: string;
  energy?: "low" | "medium" | "high";
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Body;
  const durationMin = body.durationMin && body.durationMin > 0 ? body.durationMin : 90;
  const theme = (body.theme ?? "").trim();
  const energy = body.energy ?? null;

  const userSb = await createSupabaseServerClient();
  const {
    data: { user },
  } = await userSb.auth.getUser();
  if (!user) return new Response("unauthorized", { status: 401 });

  const sb = createSupabaseServiceClient();
  // Pull the full open pool for THIS USER — service-role bypasses RLS,
  // so we must filter by user.id explicitly.
  const { data: items } = await sb
    .from("s2d_items")
    .select(
      "id, ticket_number, title, description, pathway, priority, status, est_minutes, queue_reason, source_label, company_id, needs_review"
    )
    .eq("user_id", user.id)
    .neq("status", "done")
    .neq("status", "in_progress")
    .eq("needs_review", false)
    .limit(300);

  if (!items || items.length === 0) {
    return NextResponse.json({ orderedIds: [], rationale: "No open items to plan from." });
  }

  // Companies for context — also user-scoped
  const { data: companies } = await sb
    .from("companies")
    .select("id, name")
    .eq("user_id", user.id);
  const companyById = new Map((companies ?? []).map((c) => [c.id, c.name]));

  const today = new Date().toISOString().slice(0, 10);
  const dow = new Date().toLocaleDateString(undefined, { weekday: "long" });
  const userCtx = await getUserContext(user.id);
  const userName = userCtx.firstName;

  const system = `You build ${userName}'s sprint. They're the product lead at Beacon Software (a PE-backed software holdco), planning a focused work window from their open task pool.

Today: ${today} (${dow}).

# Your task
Pick a SUBSET of items from the pool that:
1. Fits within the time budget the user specified — don't blow past it. If items lack est_minutes, assume sensible defaults (quick_reply=10, drafted_response=20, decision_gate=25, heads_down=45, meeting_backed=30, delegated=15, watching=10).
2. Matches the theme if one is given. Theme is free-text — interpret it broadly (e.g. "decisions" → decision_gate pathway; "Snailworks" → items mentioning Snailworks; "quick wins" → quick_replies under 15m).
3. Respects energy if given. Low energy → admin/reply work, no heavy heads_down. High energy → frontload the heads_down + decision_gate items.

# Ordering within the sprint
- True urgency first (explicit deadlines, blockers, exec/customer-waiting)
- Cluster similar work (heads_down together, quick_replies together)
- High-cognitive items earlier in the window (when energy is fresh)
- Quick wins can go first to clear the deck if they unblock others

# What to LEAVE OUT
- Items waiting on someone else (pathway=delegated/watching) unless the theme explicitly asks for them
- Items with queue_reasons suggesting they're blocked until a specific external event
- Items that don't fit the theme — better a tight 60-minute sprint that matches than a sloppy 90 that doesn't

# Output
Strict JSON, no fences, no preamble:
{
  "orderedIds": ["<id1>", "<id2>", ...],
  "rationale": "1-2 sentences explaining your picks and ordering"
}

Estimated time of the selected subset should be within ${Math.max(60, durationMin - 15)}–${durationMin + 5} minutes.`;

  const itemLines = items
    .map((i) => {
      const company = i.company_id ? companyById.get(i.company_id) ?? "" : "";
      const est = i.est_minutes ?? defaultEstFor(i.pathway);
      return `id=${i.id}
  MASH-${i.ticket_number} · ${i.pathway} · ${i.priority} · ${est}m · status=${i.status}${company ? ` · ${company}` : ""}
  title: ${i.title}
  ${i.queue_reason ? `queue: ${i.queue_reason}` : ""}
  ${i.description ? `desc: ${i.description.slice(0, 180)}` : ""}`;
    })
    .join("\n\n");

  const userMsg = `# Sprint constraints
Duration budget: ${durationMin} minutes
${theme ? `Theme: ${theme}` : "Theme: (none — pick the highest-leverage items)"}
${energy ? `Energy: ${energy}` : "Energy: (unspecified)"}

# Open item pool (${items.length})
${itemLines}

Build the sprint. Return JSON.`;

  try {
    const resp = await trackedCreate(
      {
        model: MODELS.primary,
        system,
        messages: [{ role: "user", content: userMsg }],
        max_tokens: 1200,
      },
      "sprint_build"
    );
    const text = resp.content[0]?.type === "text" ? resp.content[0].text.trim() : "{}";
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const parsed = JSON.parse(cleaned) as {
      orderedIds?: string[];
      rationale?: string;
    };
    const validIds = new Set(items.map((i) => i.id));
    const orderedIds = (parsed.orderedIds ?? []).filter((id) => validIds.has(id));
    return NextResponse.json({
      orderedIds,
      rationale: parsed.rationale ?? "",
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "build failed" },
      { status: 500 }
    );
  }
}

function defaultEstFor(pathway: string): number {
  switch (pathway) {
    case "quick_reply": return 10;
    case "drafted_response": return 20;
    case "decision_gate": return 25;
    case "heads_down": return 45;
    case "meeting_backed": return 30;
    case "delegated": return 15;
    case "watching": return 10;
    default: return 30;
  }
}
