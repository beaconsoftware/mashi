import { MODELS } from "./client";
import { trackedCreate } from "./tracked";
import type { S2DItem, Pathway } from "@/types";

/**
 * Success-statement generator (Phase 5 — Contract card).
 *
 * Asked at the contract card before sprint launch: "At the end of this
 * sprint you will have…" A one-line, present-tense, outcome-shaped
 * statement per item. Pathway-aware: a quick_reply success looks like
 * "Sent the reply to Mihir"; a decision_gate success looks like "Decided
 * on Q4 brand spend"; etc. The user can edit before launching.
 *
 * Cheap by design — one call per sprint, batched across items. Uses the
 * fast model.
 */

interface BuildOpts {
  items: Array<Pick<S2DItem, "id" | "title" | "pathway" | "description">>;
  userId: string;
}

interface SuccessStatement {
  itemId: string;
  statement: string;
}

const SYSTEM_PROMPT = `You write one-line success statements for a busy executive about to enter a focused sprint.

Each statement completes the sentence: "At the end of this sprint I will have ___"

Constraints:
- Present-perfect tense ("Sent ___", "Decided ___", "Drafted ___", "Reviewed ___").
- Shape the verb to match the pathway:
    quick_reply / drafted_response → "Sent ___" / "Replied to ___"
    decision_gate → "Decided ___"
    heads_down → "Finished ___" / "Built ___" / "Wrote ___"
    meeting_backed → "Prepped ___" / "Staged ___ for the meeting"
    delegated → "Confirmed ___ is moving" / "Nudged ___"
    watching → "Checked in on ___"
- ≤ 12 words.
- Concrete, specific. Reference names, projects, or the noun of the item.
- No hedging ("hopefully", "tried to"). The user is committing.
- Return JSON ONLY in the schema described.`;

export async function generateSuccessStatements({
  items,
  userId,
}: BuildOpts): Promise<SuccessStatement[]> {
  if (items.length === 0) return [];

  const itemBlock = items
    .map(
      (it, i) =>
        `[${i + 1}] id=${it.id} pathway=${it.pathway}\nTitle: ${it.title}${it.description ? `\nContext: ${it.description.slice(0, 240)}` : ""}`
    )
    .join("\n\n");

  const user = `Items in the sprint:
${itemBlock}

Return JSON with this exact schema (one entry per item, in the same order):
{
  "statements": [
    { "itemId": "${items[0].id}", "statement": "..." }
  ]
}

No prose outside the JSON.`;

  const resp = await trackedCreate(
    {
      model: MODELS.fast,
      max_tokens: 600,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: user }],
    },
    "sprint:success-statement",
    userId
  );

  const text = textFromMessage(resp);
  const parsed = safeJson(text);
  if (!parsed?.statements) {
    return items.map((it) => ({
      itemId: it.id,
      statement: fallbackStatement(it),
    }));
  }
  const byId = new Map<string, string>();
  for (const entry of parsed.statements) {
    if (
      entry &&
      typeof entry.itemId === "string" &&
      typeof entry.statement === "string" &&
      entry.statement.trim().length > 0
    ) {
      byId.set(entry.itemId, entry.statement.trim());
    }
  }
  return items.map((it) => ({
    itemId: it.id,
    statement: byId.get(it.id) ?? fallbackStatement(it),
  }));
}

function fallbackStatement(
  item: Pick<S2DItem, "title" | "pathway">
): string {
  const verb = fallbackVerb(item.pathway);
  return `${verb} ${item.title}`.slice(0, 120);
}

function fallbackVerb(pathway: Pathway): string {
  switch (pathway) {
    case "quick_reply":
    case "drafted_response":
      return "Sent a reply on";
    case "decision_gate":
      return "Decided on";
    case "heads_down":
      return "Finished";
    case "meeting_backed":
      return "Prepped";
    case "delegated":
      return "Confirmed progress on";
    case "watching":
      return "Checked in on";
  }
}

interface RawResp {
  statements?: Array<{ itemId?: unknown; statement?: unknown }>;
}

function textFromMessage(resp: {
  content: Array<{ type: string; text?: string }>;
}): string {
  return resp.content
    .map((b) => (b.type === "text" ? (b.text ?? "") : ""))
    .join("\n")
    .trim();
}

function safeJson(text: string): RawResp | null {
  try {
    return JSON.parse(text) as RawResp;
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as RawResp;
    } catch {
      return null;
    }
  }
}
