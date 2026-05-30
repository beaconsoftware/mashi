/**
 * K1 — streaming cadence smoothing (pure core).
 *
 * Anthropic SSE deltas arrive in irregular bursts. Rendering them the instant
 * they land makes text appear in lurches — the opposite of the smooth, steady
 * reveal a premium agent surface has. The fix is a client-side reveal buffer:
 * incoming deltas accumulate into a target string, and a requestAnimationFrame
 * loop reveals characters toward that target at a smooth, adaptive rate.
 *
 * This module is the rate decision, kept pure so it is unit-testable without a
 * DOM or a rAF clock. `useRevealBuffer` (src/hooks/use-reveal-buffer.ts) owns
 * the rAF loop and React state and calls this each frame.
 *
 * The rate is adaptive on purpose: it scales with the backlog so the reveal
 * never lags far behind a fast generation (it speeds up under load, never
 * freezes) yet a slow trickle still advances a few characters per frame so the
 * caret keeps moving. It never overshoots the target.
 */

/** Smallest advance per frame, so even a 1-char backlog still moves. */
export const MIN_REVEAL_STEP = 3;

/**
 * Roughly the number of frames over which the current backlog is drained. A
 * larger backlog therefore reveals proportionally faster (backlog / DRAIN
 * chars per frame), which keeps the visible text within a small bounded lag of
 * the real stream instead of falling further behind on a burst. At ~60fps,
 * DRAIN = 6 targets draining a backlog in ~100ms.
 */
export const REVEAL_DRAIN_FRAMES = 6;

/**
 * The next revealed length, given how much is revealed now and the full target
 * length. Advances by max(MIN_REVEAL_STEP, ceil(backlog / DRAIN)), clamped to
 * the target so it never overshoots. Returns `current` unchanged once caught
 * up (the caller stops the rAF loop on equality).
 */
export function nextRevealLength(current: number, targetLength: number): number {
  if (current >= targetLength) return targetLength;
  const backlog = targetLength - current;
  const step = Math.max(MIN_REVEAL_STEP, Math.ceil(backlog / REVEAL_DRAIN_FRAMES));
  return Math.min(targetLength, current + step);
}
