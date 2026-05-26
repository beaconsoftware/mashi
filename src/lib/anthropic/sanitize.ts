/**
 * Em / en / fake-em dash stripper. Applied uniformly to every text fragment
 * Claude emits before any caller (streaming OR non-streaming) sees it.
 *
 * Why this exists at the SDK boundary, not in callers:
 *   - Em-dashes (U+2014) and en-dashes (U+2013) are the single most reliable
 *     AI tell in written copy. Even with strict prompt rules, models
 *     occasionally regress.
 *   - We don't want every caller (~20 of them across src/app/api,
 *     src/lib/triage, src/lib/anthropic) to remember to sanitize. One
 *     boundary, one rule.
 *   - ASCII hyphen (U+002D) is untouched. Hyphenated words ("go-to-market",
 *     "back-and-forth"), number ranges with hyphens ("3-5pm"), command flags,
 *     etc. all survive.
 *
 * Substitution rules:
 *   "—" / " — " / "—word" / "word—" → ", " (with surrounding spaces collapsed)
 *   "–" / same patterns                → ", "
 *   " -- " (ASCII double-hyphen as em) → ", "
 *
 * Number ranges expressed with en-dashes ("5–10") collateral-damage into
 * "5, 10". Rare enough in chat/draft output that we accept it; the prompt-
 * level rule discourages models from emitting them in the first place.
 */
export function sanitizeForAITells(s: string): string {
  return s
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/\s+--\s+/g, ", ");
}

import type Anthropic from "@anthropic-ai/sdk";

/**
 * Sanitize every text block in a non-streaming Anthropic Messages response.
 * Returns the same response object (mutated in place) for ergonomics — every
 * existing caller pattern `const resp = await trackedCreate(...); const text
 * = resp.content[0].text` keeps working with no change.
 */
export function sanitizeMessageResponse(
  resp: Anthropic.Messages.Message
): Anthropic.Messages.Message {
  for (const block of resp.content) {
    if (block.type === "text") {
      block.text = sanitizeForAITells(block.text);
    }
  }
  return resp;
}
