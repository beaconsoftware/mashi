/**
 * K1 — unit tests for the streaming-reveal rate core.
 *
 * Self-running assertion script (no framework, matching the other agent
 * tests). Runs with:
 *   pnpm test:reveal
 *
 * Covers the acceptance criteria's testable half — the adaptive rate:
 *   - never overshoots the target;
 *   - always advances while behind (never freezes), even on a 1-char backlog;
 *   - speeds up as the backlog grows (a burst drains proportionally faster);
 *   - simulated frame-by-frame, a large backlog is fully drained in a bounded
 *     number of frames (it catches up, it doesn't lag forever).
 */
import {
  MIN_REVEAL_STEP,
  REVEAL_DRAIN_FRAMES,
  nextRevealLength,
} from "@/lib/agent/reveal";

const stats = { pass: 0, fail: 0 };

function assert(ok: boolean, label: string) {
  if (ok) {
    stats.pass += 1;
    console.log(`  ✓ ${label}`);
  } else {
    stats.fail += 1;
    console.error(`  ✗ ${label}`);
  }
}

// --- never overshoots --------------------------------------------------------
assert(nextRevealLength(0, 0) === 0, "empty target stays at 0");
assert(nextRevealLength(5, 5) === 5, "caught up stays put");
assert(nextRevealLength(10, 5) === 5, "clamps current past target back to target");
assert(nextRevealLength(0, 2) === 2, "a backlog smaller than the min step lands exactly on target");
assert(nextRevealLength(0, 1) === 1, "a 1-char backlog reveals exactly that char, no overshoot");

// --- always advances while behind -------------------------------------------
assert(nextRevealLength(0, 1000) > 0, "advances when behind");
assert(
  nextRevealLength(0, MIN_REVEAL_STEP) === MIN_REVEAL_STEP,
  "small backlog advances by at least the min step (clamped to target)"
);
assert(
  nextRevealLength(100, 104) - 100 === Math.min(4, MIN_REVEAL_STEP) ||
    nextRevealLength(100, 104) === 104,
  "tiny backlog still lands on target without overshoot"
);

// --- speeds up under backlog -------------------------------------------------
const smallStep = nextRevealLength(0, 30) - 0;
const bigStep = nextRevealLength(0, 6000) - 0;
assert(bigStep > smallStep, "a larger backlog advances by a larger step (adaptive)");
assert(
  bigStep === Math.ceil(6000 / REVEAL_DRAIN_FRAMES),
  "big-backlog step is backlog / drain-frames"
);

// --- bounded catch-up (full drain simulation) -------------------------------
// Push a large target and step frame-by-frame; it must reach the target and
// must do so without ever exceeding it, in a bounded frame count.
function framesToDrain(target: number): { frames: number; overshot: boolean } {
  let cur = 0;
  let frames = 0;
  let overshot = false;
  while (cur < target) {
    const next = nextRevealLength(cur, target);
    if (next > target) overshot = true;
    if (next === cur) break; // guard against a non-advancing rate (would hang)
    cur = next;
    frames += 1;
    if (frames > 10_000) break; // safety
  }
  return { frames, overshot };
}

const drain = framesToDrain(5000);
assert(!drain.overshot, "frame-by-frame drain of a 5000-char burst never overshoots");
assert(drain.frames > 0 && drain.frames < 200, "a 5000-char burst drains in a bounded frame count");

// A steady trickle (re-target +1 each frame) keeps moving and stays close.
let trickleTarget = 0;
let trickleCur = 0;
let stalled = false;
for (let i = 0; i < 500; i += 1) {
  trickleTarget += 1; // one new char per frame
  const next = nextRevealLength(trickleCur, trickleTarget);
  if (next === trickleCur && trickleCur < trickleTarget) stalled = true;
  trickleCur = next;
}
assert(!stalled, "a 1-char-per-frame trickle never stalls the reveal");
assert(trickleCur === trickleTarget, "a trickle keeps the reveal fully caught up");

console.log(`\nreveal: ${stats.pass} passed, ${stats.fail} failed`);
if (stats.fail > 0) process.exit(1);
