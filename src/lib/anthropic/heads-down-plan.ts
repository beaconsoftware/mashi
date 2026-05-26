import { MODELS } from "./client";
import { trackedCreate } from "./tracked";
import type { EnrichSourceKind } from "@/hooks/use-enriched-context";
import type { S2DItem } from "@/types";

/**
 * Heads-down plan + handoff prompt generator.
 *
 * Called from the contract card pre-warm (Phase 5) and ad-hoc from the
 * HeadsDownCanvas via /api/s2d/{id}/heads-down/plan. Returns a 3-step
 * plan plus a bundled handoff prompt the user can paste straight into
 * Claude Desktop, Claude Code, or any other tool they hand the work to.
 */

export interface HeadsDownPlanStep {
  id: string;
  text: string;
  checked: boolean;
}

export interface HeadsDownPlan {
  steps: HeadsDownPlanStep[];
  handoffPrompt: string;
}

const SYSTEM_PROMPT = `You set up a heads-down focus block for a busy product executive.

The user will leave Mashi and do this work in another tool (Claude Desktop, Claude Code, a doc, an IDE). Your job: produce a tight 3-step plan and a handoff prompt that gets them moving in under 30 seconds when they paste it elsewhere.

Constraints:
- Exactly 3 plan steps, each <= 14 words, each a verb-first action.
- Steps must be sequential and concrete — no "consider X" or "think about Y".
- Handoff prompt: include the item title, key context bullets from sources, and a single explicit ask.
- The handoff prompt is the FIRST message of an external conversation — write it directly as if the user is talking to the next tool. No meta-commentary.
- Return JSON ONLY in the schema described.`;

interface BuildOpts {
  item: S2DItem;
  sources: Array<{
    kind: EnrichSourceKind;
    ref: string;
    label: string;
    snippet: string;
    pinned?: boolean;
  }>;
  userId: string;
}

export async function generateHeadsDownPlan({
  item,
  sources,
  userId,
}: BuildOpts): Promise<HeadsDownPlan> {
  const sourceBlock =
    sources
      .slice(0, 8)
      .map(
        (s, i) =>
          `[S${i + 1} ${s.kind}${s.pinned ? " · pinned" : ""}] ${s.label}\n${s.snippet}`
      )
      .join("\n\n") || "(no enriched sources yet)";

  const user = `Item: "${item.title}"
${item.description ? `Description: ${item.description}` : ""}
Company: ${item.company?.name ?? "—"}

Sources you may reference by label:
${sourceBlock}

Return JSON with this exact schema:
{
  "steps": [string, string, string],
  "handoffPrompt": string
}

No prose outside the JSON.`;

  const resp = await trackedCreate(
    {
      model: MODELS.secondary,
      max_tokens: 900,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: user }],
    },
    "sprint:heads-down-plan",
    userId
  );

  const text = textFromMessage(resp);
  const parsed = safeJson(text);
  if (!parsed) {
    throw new Error("heads-down-plan: model did not return JSON");
  }
  const rawSteps = arrayOfStrings(parsed.steps).slice(0, 3);
  const steps: HeadsDownPlanStep[] = rawSteps.map((textStep, i) => ({
    id: `step-${i + 1}`,
    text: textStep,
    checked: false,
  }));
  const handoffPrompt = stringOr(parsed.handoffPrompt, "");
  return { steps, handoffPrompt };
}

interface RawPlan {
  steps?: unknown;
  handoffPrompt?: unknown;
}

function textFromMessage(resp: {
  content: Array<{ type: string; text?: string }>;
}): string {
  return resp.content
    .map((b) => (b.type === "text" ? (b.text ?? "") : ""))
    .join("\n")
    .trim();
}

function safeJson(text: string): RawPlan | null {
  try {
    return JSON.parse(text) as RawPlan;
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as RawPlan;
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

function stringOr(v: unknown, fallback: string): string {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : fallback;
}
