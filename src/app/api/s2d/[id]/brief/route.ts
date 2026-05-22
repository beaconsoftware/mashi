import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveItemContext } from "@/lib/s2d/context-resolver";
import { trackedCreate, MODELS } from "@/lib/anthropic/tracked";
import {
  type ItemBrief,
  emptyBrief,
  renderContextForBrief,
} from "@/lib/s2d/item-brief";
import { getUserContext } from "@/lib/user-context";
import type { S2DItem } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/s2d/:id/brief
 *
 * Layer 1 of the action toolkit. Pulls every linked source for an item,
 * then runs a Sonnet-tier synthesis pass that returns a structured
 * ItemBrief: who's involved, what's been said vs. unsaid, what's
 * outstanding, what the temperature is, what to do next.
 *
 * The output is the substrate every Layer 2 action agent reads from.
 * Cached client-side per-sprint via the use-item-brief TanStack hook.
 *
 * Why GET (not POST): the brief is deterministic w.r.t. the item's current
 * state, so a GET with HTTP caching semantics is appropriate. The hook
 * uses TanStack staleTime to avoid re-firing on every slot activation.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const { data: item, error: itemErr } = await supabase
    .from("s2d_items")
    .select("*")
    .eq("id", id)
    .single();
  if (itemErr || !item) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  const ctx = await resolveItemContext(supabase, item as S2DItem);

  // If there's nothing to synthesize, return an empty brief instead of
  // burning a model call on three lines of input.
  if (ctx.sources.length === 0) {
    return NextResponse.json(emptyBrief(id, MODELS.secondary));
  }

  const itemFacts = formatItemFacts(item as S2DItem);
  const sourceDump = renderContextForBrief(ctx);

  const userCtx = await getUserContext(user.id);
  const userName = userCtx.firstName;
  const userEmailLine = userCtx.email
    ? `${userName} writes from "${userCtx.email}". Anything from them is OUTBOUND; anything to them is INBOUND.`
    : `Identify ${userName}'s outbound vs inbound messages from the source content. Anything from ${userName} is OUTBOUND; anything to them is INBOUND.`;

  const system = `You are a context consolidator for ${userName}'s task board. You read every signal Mashi has about ONE task and synthesize a tight, structured brief that downstream agents can act on.

You output ONE JSON object that matches the schema below. NOTHING ELSE. No prose before or after. No code fences. Just JSON.

Schema:
{
  "headline": string,                         // one sentence, where this work stands today
  "key_people": [
    { "name": string, "role": string | null, "last_touch_at": ISO8601 | null, "last_touch_direction": "inbound" | "outbound" | "unknown" | null }
  ],
  "timeline": [
    { "at": ISO8601, "source": "gmail"|"slack"|"linear"|"fireflies"|"calendar"|"internal", "summary": string }
  ],
  "outstanding_questions": string[],          // explicit asks to ${userName} not yet answered
  "what_user_has_said": string[],             // statements ${userName} made on the record, short paraphrases
  "what_user_has_not_said": string[],         // gaps in ${userName}'s communication the other side may be waiting on
  "open_commitments": string[],               // promises ${userName} made that aren't yet fulfilled
  "temperature": "escalating" | "steady" | "cooled_off" | "unknown",
  "recommended_next_move": string,            // one sentence
  "stakeholders_to_consider": string[]        // names that aren't core but should be cc'd / looped in
}

Rules:
- Be concrete. Real names, real timestamps, real quotes. Never invent facts.
- Strings stay short. The brief is a synthesis, not a re-dump.
- If you don't have signal for a field, return an empty array or null.
- NO em dashes (—) or en dashes (–). Use commas, periods, or rewrite.
- ${userEmailLine}
- Today's date is ${new Date().toISOString().slice(0, 10)}.`;

  const userPrompt = `# Task facts
${itemFacts}

# Source content (recent, most-relevant first per source)
${sourceDump}

Produce the JSON brief now.`;

  let brief: ItemBrief;
  try {
    const resp = await trackedCreate(
      {
        model: MODELS.secondary,
        max_tokens: 1500,
        system,
        messages: [{ role: "user", content: userPrompt }],
      },
      "item_brief",
      user.id
    );

    const text = resp.content
      .map((c) => (c.type === "text" ? c.text : ""))
      .join("")
      .trim();
    const json = extractJson(text);

    const parsed = (typeof json === "object" && json !== null
      ? (json as Record<string, unknown>)
      : {}) as Partial<ItemBrief>;

    brief = {
      meta: {
        item_id: id,
        generated_at: new Date().toISOString(),
        model: MODELS.secondary,
        sources_considered: ctx.sources.length,
      },
      headline: typeof parsed.headline === "string" ? parsed.headline : null,
      key_people: Array.isArray(parsed.key_people) ? parsed.key_people : [],
      timeline: Array.isArray(parsed.timeline) ? parsed.timeline : [],
      outstanding_questions: Array.isArray(parsed.outstanding_questions)
        ? parsed.outstanding_questions
        : [],
      what_user_has_said: Array.isArray(parsed.what_user_has_said)
        ? parsed.what_user_has_said
        : [],
      what_user_has_not_said: Array.isArray(parsed.what_user_has_not_said)
        ? parsed.what_user_has_not_said
        : [],
      open_commitments: Array.isArray(parsed.open_commitments)
        ? parsed.open_commitments
        : [],
      temperature:
        parsed.temperature === "escalating" ||
        parsed.temperature === "steady" ||
        parsed.temperature === "cooled_off"
          ? parsed.temperature
          : "unknown",
      recommended_next_move:
        typeof parsed.recommended_next_move === "string"
          ? parsed.recommended_next_move
          : null,
      stakeholders_to_consider: Array.isArray(parsed.stakeholders_to_consider)
        ? parsed.stakeholders_to_consider
        : [],
    };
  } catch (err) {
    // If the model errored, surface an empty brief so the toolkit still
    // renders with the underlying source data. Don't take the sprint down
    // because of a single LLM hiccup.
    console.warn("[item_brief] synthesis failed:", err);
    brief = emptyBrief(id, MODELS.secondary);
    brief.meta.sources_considered = ctx.sources.length;
  }

  return NextResponse.json(brief);
}

function formatItemFacts(item: S2DItem): string {
  const lines = [
    `MASH-${item.ticket_number ?? "?"}: ${item.title}`,
    `pathway: ${item.pathway} / priority: ${item.priority} / status: ${item.status}`,
  ];
  if (item.description) lines.push(`description: ${item.description}`);
  if (item.delegated_to) lines.push(`delegated to: ${item.delegated_to}`);
  if (item.queue_reason) lines.push(`queue reason: ${item.queue_reason}`);
  if (item.outcome) lines.push(`outcome so far: ${item.outcome}`);
  if (item.company?.name) lines.push(`company: ${item.company.name}`);
  return lines.join("\n");
}

/**
 * Extract the first JSON object from a model response. Tolerates the model
 * accidentally wrapping in a fence even after we tell it not to.
 */
function extractJson(text: string): unknown {
  // Strip markdown fences if present
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced ? fenced[1] : text).trim();
  // Find the first {...} block
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}
