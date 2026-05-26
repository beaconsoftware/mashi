import { MODELS } from "./client";
import { trackedCreate } from "./tracked";
import type { EnrichSourceKind } from "@/hooks/use-enriched-context";
import type { S2DItem } from "@/types";

/**
 * Decision-gate 4-option brief generator.
 *
 * Called from the contract card (Phase 5) — and ad-hoc from the
 * DecideCanvas via /api/s2d/{id}/decision/brief — when the user opts
 * in to the higher-token pre-warm for a decision item. Produces
 * structured Yes/No/Yes-but/Defer bullets the canvas renders as
 * starter content for each choice card.
 */

export interface DecisionBriefSourceCite {
  kind: EnrichSourceKind;
  ref: string;
  label: string;
}

export interface DecisionBrief {
  yes: { whyBullets: string[]; preParadeLine: string };
  no: { whyBullets: string[]; preMortemLine: string };
  yesBut: { conditions: string[] };
  defer: { triggerCandidates: string[] };
  sourcesCited: DecisionBriefSourceCite[];
}

const SYSTEM_PROMPT = `You produce a short, structured decision brief for a busy product executive.

The user is about to commit to a Yes / No / Yes-but / Defer choice. Your job is to fill the four choice cards with sharp, specific bullets — not generic platitudes. Cite source labels in brackets when an argument comes from a specific source.

Constraints:
- 2-3 bullets per choice card.
- Each bullet ≤ 16 words.
- One Pre-parade line (if Yes works, what does the win look like?) and one Pre-mortem line (if No, what gets worse?).
- Yes-but: 2-3 candidate conditions to gate a Yes ("Yes, IF …").
- Defer: 2-3 candidate triggers that would unblock the decision later.
- Never hedge ("it depends", "could be") — state the bullet plainly.
- Return JSON ONLY in the schema described.`;

interface BuildOpts {
  item: S2DItem;
  sources: Array<{
    kind: EnrichSourceKind;
    ref: string;
    label: string;
    snippet: string;
  }>;
  userId: string;
}

export async function generateDecisionBrief({
  item,
  sources,
  userId,
}: BuildOpts): Promise<DecisionBrief> {
  const sourceBlock =
    sources
      .slice(0, 8)
      .map((s, i) => `[S${i + 1} ${s.kind}] ${s.label}\n${s.snippet}`)
      .join("\n\n") || "(no enriched sources yet)";

  const user = `Decision question: "${item.title}"
${item.description ? `Description: ${item.description}` : ""}
Company: ${item.company?.name ?? "—"}

Sources you may cite by their label:
${sourceBlock}

Return JSON with this exact schema:
{
  "yes":     { "whyBullets": [string, ...], "preParadeLine": string },
  "no":      { "whyBullets": [string, ...], "preMortemLine": string },
  "yesBut":  { "conditions":  [string, ...] },
  "defer":   { "triggerCandidates": [string, ...] }
}

No prose outside the JSON.`;

  const resp = await trackedCreate(
    {
      model: MODELS.secondary,
      max_tokens: 900,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: user }],
    },
    "sprint:decide-brief",
    userId
  );

  const text = textFromMessage(resp);
  const parsed = safeJson(text);
  if (!parsed) {
    throw new Error("decide-brief: model did not return JSON");
  }
  return {
    yes: {
      whyBullets: arrayOfStrings(parsed.yes?.whyBullets),
      preParadeLine: stringOr(parsed.yes?.preParadeLine, ""),
    },
    no: {
      whyBullets: arrayOfStrings(parsed.no?.whyBullets),
      preMortemLine: stringOr(parsed.no?.preMortemLine, ""),
    },
    yesBut: {
      conditions: arrayOfStrings(parsed.yesBut?.conditions),
    },
    defer: {
      triggerCandidates: arrayOfStrings(parsed.defer?.triggerCandidates),
    },
    sourcesCited: sources.slice(0, 8).map(({ kind, ref, label }) => ({
      kind,
      ref,
      label,
    })),
  };
}

interface RawBrief {
  yes?: { whyBullets?: unknown; preParadeLine?: unknown };
  no?: { whyBullets?: unknown; preMortemLine?: unknown };
  yesBut?: { conditions?: unknown };
  defer?: { triggerCandidates?: unknown };
}

function textFromMessage(resp: {
  content: Array<{ type: string; text?: string }>;
}): string {
  return resp.content
    .map((b) => (b.type === "text" ? (b.text ?? "") : ""))
    .join("\n")
    .trim();
}

function safeJson(text: string): RawBrief | null {
  try {
    return JSON.parse(text) as RawBrief;
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as RawBrief;
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
