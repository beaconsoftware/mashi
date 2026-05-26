import { MODELS } from "./client";
import { trackedCreate } from "./tracked";
import type { EnrichSourceKind } from "@/hooks/use-enriched-context";
import type { S2DItem } from "@/types";

/**
 * Meeting-backed talking-points generator.
 *
 * Called from the meeting_backed pre-warm and ad-hoc from the
 * MeetingPrepCanvas via /api/sprint/prewarm. Produces 3-5 bullet points
 * the user will paste into the meeting agenda. Each bullet ≤ 20 words,
 * verb-led where reasonable, no hedging.
 */

export interface TalkingPoints {
  bullets: string[];
}

const SYSTEM_PROMPT = `You draft talking points a busy product executive will use to prep for an upcoming meeting.

The user has decided this item should be addressed in a specific calendar meeting (not handled now). Your job: produce 3-5 sharp bullets the user can paste into the meeting agenda.

Constraints:
- 3-5 bullets, each <= 20 words.
- Each bullet must be specific to the item — not generic ("discuss the project" is not allowed).
- Prefer verb-led phrasing ("Confirm Q4 budget", "Get Jane to sign off on …").
- If sources contradict each other, name the open question explicitly.
- Return JSON ONLY in the schema described.`;

interface BuildOpts {
  item: S2DItem;
  meetingTitle?: string | null;
  sources: Array<{
    kind: EnrichSourceKind;
    ref: string;
    label: string;
    snippet: string;
  }>;
  userId: string;
}

export async function generateTalkingPoints({
  item,
  meetingTitle,
  sources,
  userId,
}: BuildOpts): Promise<TalkingPoints> {
  const sourceBlock =
    sources
      .slice(0, 8)
      .map((s, i) => `[S${i + 1} ${s.kind}] ${s.label}\n${s.snippet}`)
      .join("\n\n") || "(no enriched sources yet)";

  const user = `Item to prep: "${item.title}"
${item.description ? `Description: ${item.description}` : ""}
Company: ${item.company?.name ?? "—"}
${meetingTitle ? `Target meeting: "${meetingTitle}"` : "Target meeting: (not yet chosen — write generally)"}

Sources you may reference by label:
${sourceBlock}

Return JSON with this exact schema:
{
  "bullets": [string, string, string]
}

3-5 bullets. No prose outside the JSON.`;

  const resp = await trackedCreate(
    {
      model: MODELS.secondary,
      max_tokens: 700,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: user }],
    },
    "sprint:talking-points",
    userId
  );

  const text = resp.content
    .map((b) => (b.type === "text" ? b.text ?? "" : ""))
    .join("\n")
    .trim();

  const parsed = safeJson(text);
  if (!parsed) {
    throw new Error("talking-points: model did not return JSON");
  }
  const bullets = arrayOfStrings(parsed.bullets).slice(0, 5);
  if (bullets.length === 0) {
    throw new Error("talking-points: no bullets returned");
  }
  return { bullets };
}

interface RawPoints {
  bullets?: unknown;
}

function safeJson(text: string): RawPoints | null {
  try {
    return JSON.parse(text) as RawPoints;
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as RawPoints;
    } catch {
      return null;
    }
  }
}

function arrayOfStrings(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((s) => s.trim());
}
