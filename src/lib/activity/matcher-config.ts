/**
 * Matcher policy — single source of truth for "is this (pathway,
 * proposed_state, signal_kind) combination allowed, and if so, what's
 * the confidence floor?"
 *
 * Before this file existed, the floors and refusals lived in three
 * separate places in matcher.ts:
 *   1. A `MIN_CONFIDENCE` per-signal-kind object near the top.
 *   2. A "title_embed never proposes done" hard-coded check inside
 *      runMatcher.
 *   3. Implicit policy in decideProposedState (which controls the
 *      valid (currentStatus → proposed_state) transitions, but that
 *      stays where it is — it's about status machinery, not
 *      cost-of-wrong tuning).
 *
 * Centralising means future tuning is one table edit, not a code
 * archaeology dig.
 *
 * The policy is intentionally additive on top of decideProposedState:
 * that function decides whether a state change is even structurally
 * possible (e.g. you can't go from `done` → `in_progress`). This
 * function then decides whether the matcher should fire given how
 * confident the signal is and how reversible the change feels to the
 * user.
 *
 * Cost-of-wrong reasoning (see comments per-row below):
 *   - "done" is the highest-cost wrong move. An item that gets
 *     auto-closed pulls itself off the user's board; recovering it
 *     means hunting in the closed-items list. We refuse fuzzy
 *     (title_embed) "done" entirely and require 0.85 from every
 *     other signal kind.
 *   - "in_progress" on a heads_down pathway is the second-highest
 *     cost. Heads_down items are commitment-feeling work (strategy,
 *     framing, deep effort); jumping one to `in_progress` on a noisy
 *     signal makes the user feel like the system is putting words in
 *     their mouth about what they're working on. So heads_down +
 *     in_progress + title_embed gets pushed to 0.85.
 *   - "in_progress" on every other pathway (quick_reply, watching,
 *     etc.) is cheap to be wrong about — the user just dismisses the
 *     suggestion. Keep the title_embed floor at 0.5 there; we'd
 *     rather show a borderline match than miss real activity.
 *   - Exact-ID / URL / cloud_lifecycle signals are high-fidelity by
 *     construction (a Linear ID matching is hard evidence, not a
 *     guess); 0.85 covers all of them.
 */

import type { MatcherSignalKind, ProposedState } from "./types";

/**
 * Pathway values mirror the CHECK constraint on s2d_items.pathway
 * (see migrations/001_initial_schema.sql). Kept as a string-union
 * with an explicit `unknown` escape hatch so callers can pass a raw
 * DB string without a runtime coerce.
 */
export type Pathway =
  | "quick_reply"
  | "drafted_response"
  | "meeting_backed"
  | "heads_down"
  | "decision_gate"
  | "delegated"
  | "watching"
  | "unknown";

export type MatcherPolicy =
  | { allowed: false; reason: string }
  | { allowed: true; min_confidence: number };

interface PolicyInput {
  pathway: Pathway | string;
  proposed_state: ProposedState;
  signal_kind: MatcherSignalKind;
}

/**
 * The two default floors for the allowed combinations:
 *
 *   HIGH (0.85): exact_id / url_match / cloud_lifecycle — strong
 *     evidence by construction; also the new tightened floor for
 *     heads_down + in_progress + title_embed (see C5).
 *   SOFT (0.50): title_embed on the cheap-to-be-wrong pathways. The
 *     UI never auto-promotes from this tier (NG1), so a borderline
 *     suggestion is just a chip the user can dismiss.
 */
const FLOOR_HIGH = 0.85;
const FLOOR_SOFT = 0.5;

/**
 * Resolve the policy for a given (pathway, proposed_state,
 * signal_kind) combination.
 *
 * Order of checks matters — refusals must come before the default
 * "allow with floor" so that, e.g., title_embed → done is refused
 * before we even consider a confidence floor.
 */
export function getMatcherPolicy(input: PolicyInput): MatcherPolicy {
  const { pathway, proposed_state, signal_kind } = input;

  // --- Refusals (cost-of-wrong: highest) ---------------------------

  // R1. title_embed never proposes `done`. Fuzzy title overlap is the
  // noisiest tier and `done` is the most destructive-feeling state
  // change (item disappears from the user's board). PRD §8 + v2 spec.
  if (signal_kind === "title_embed" && proposed_state === "done") {
    return {
      allowed: false,
      reason: "title_embed cannot propose done (destructive + noisy tier)",
    };
  }

  // --- Allowed: per-row floors -------------------------------------

  // A1. heads_down + in_progress + title_embed → tightened floor (C5).
  // Heads_down items are commitment-feeling deep work; auto-jumping
  // them to in_progress on a fuzzy signal feels intrusive. Require
  // strong similarity (≥ 0.85, same bar as exact-ID).
  if (
    pathway === "heads_down" &&
    proposed_state === "in_progress" &&
    signal_kind === "title_embed"
  ) {
    return { allowed: true, min_confidence: FLOOR_HIGH };
  }

  // A2. Any other title_embed → in_progress combination → soft floor.
  // Cheap to be wrong: user dismisses the chip, the system learns
  // (via the 24h rejection back-off) and moves on.
  if (signal_kind === "title_embed" && proposed_state === "in_progress") {
    return { allowed: true, min_confidence: FLOOR_SOFT };
  }

  // A3. Everything else (exact_id, url_match, cloud_lifecycle, for
  // either in_progress or done). High-fidelity signals; standard
  // 0.85 floor covers both proposed states across all pathways.
  if (
    signal_kind === "exact_id" ||
    signal_kind === "url_match" ||
    signal_kind === "cloud_lifecycle"
  ) {
    return { allowed: true, min_confidence: FLOOR_HIGH };
  }

  // Defensive fallback. If we reach here, something in the type
  // union grew without the table being updated. Refuse rather than
  // accidentally auto-allow.
  return {
    allowed: false,
    reason: `no policy row for (${pathway}, ${proposed_state}, ${signal_kind})`,
  };
}
