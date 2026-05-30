/**
 * P6.a (Epic F1) — pure logic for agent-proposed MASHI.md memory writes.
 *
 * Deliberately free of any Supabase / React import so it is safe to unit-test
 * in isolation (`pnpm test:memory`) and to pull into the `propose_memory` tool
 * handler. It answers one question: given the current MASHI.md and a durable
 * fact the agent wants to remember, what does the file become, and is that
 * within the char cap?
 *
 * The cap mirrors `/api/user/mashi-md` (8000 chars). Keep the two in lockstep:
 * the column itself is unbounded TEXT, the cap is a product limit enforced in
 * both the human editor's route and here.
 */

/** Product cap on MASHI.md length. Mirrors MAX_CHARS in mashi-md/route.ts. */
export const MASHI_MD_MAX_CHARS = 8000;

/** Fraction of the cap past which we warn the model to offer consolidation. */
export const MASHI_MD_NEAR_LIMIT_RATIO = 0.9;

export interface MemoryAppendResult {
  /** The file content after the append. Only meaningful when `ok`. */
  next: string;
  /** Whether the append fits within the cap. */
  ok: boolean;
  /** Length of `next` (the would-be file). */
  length: number;
  /** True once the (successful) result sits past NEAR_LIMIT_RATIO of the cap,
   * so the tool can nudge the user to consolidate before the next write. */
  nearLimit: boolean;
  /** Set when `!ok` — a human-readable reason the append was rejected. */
  error?: string;
}

/**
 * Normalize a proposed fact into a single MASHI.md bullet line.
 *
 * - collapses internal newlines to spaces (a memory is one durable line, not a
 *   multi-paragraph note),
 * - trims surrounding whitespace,
 * - strips a leading bullet marker the model may have included ("- ", "* "),
 *   so we never double-bullet.
 */
export function normalizeFact(fact: string): string {
  return fact
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[-*]\s+/, "")
    .trim();
}

/**
 * Compute the MASHI.md content after appending `fact` as a new bullet.
 *
 * Pure: does not read or write anything. The caller persists `next` only when
 * `ok` is true. A fact that would push the file over the cap is rejected with
 * `ok: false` and an `error` the tool relays so the model can offer to
 * consolidate rather than silently dropping the memory.
 */
export function buildMemoryAppend(
  current: string,
  fact: string,
  cap: number = MASHI_MD_MAX_CHARS
): MemoryAppendResult {
  const clean = normalizeFact(fact);
  if (clean.length === 0) {
    return {
      next: current,
      ok: false,
      length: current.length,
      nearLimit: false,
      error: "The fact to remember is empty after trimming.",
    };
  }

  const base = current.trimEnd();
  const bullet = `- ${clean}`;
  const next = base.length > 0 ? `${base}\n${bullet}` : bullet;
  const length = next.length;

  if (length > cap) {
    return {
      next: current,
      ok: false,
      length,
      nearLimit: true,
      error: `Appending this would make MASHI.md ${length} chars, over the ${cap}-char limit. Offer to consolidate or trim existing memory first.`,
    };
  }

  return {
    next,
    ok: true,
    length,
    nearLimit: length >= cap * MASHI_MD_NEAR_LIMIT_RATIO,
  };
}
