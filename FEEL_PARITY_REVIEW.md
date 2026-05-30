# Feel-parity acceptance gate (Epic K5)

> The bar for the agent surface is not "it renders correctly" — it is "it feels
> like Claude.ai / Basedash." That can't be asserted from a checklist; it has to
> be reviewed against the reference apps, side by side. This doc is the required
> gate before Epic K (and the I8/I9 identity redesigns) is signed off.
>
> A grep (`pnpm audit:motion`) catches banned patterns and dead surfaces; it
> cannot prove smoothness. This review is the real bar. Run it whenever the
> agent surface's motion, streaming, or scroll behavior changes.

## How to run it

For each dimension below, put Mashi and the reference app side by side (same
prompt class, same window size), exercise the dimension, and capture a short
screen recording. Optionally capture a DevTools Performance trace where a
frame-timing claim is made (expand, streaming).

The acceptance bar (K5): **a reviewer shown both apps without labels cannot
reliably pick which is "the less smooth one" on each dimension.** Anything that
reads a notch below the reference is a bounce — log the specific gap in the
"Gaps" column and fix it before sign-off. Re-run across all three agent
surfaces (Spotlight ⌘K, item-bound thread, sprint Focus-card chat); a pass on
one surface is not a pass on all three.

## Dimensions

| # | Dimension | Reference | What to do | Pass bar | Brief |
|---|-----------|-----------|------------|----------|-------|
| 1 | Streaming cadence | Claude.ai | Send a prompt that produces a long answer; watch the text reveal at both fast and slow generation speeds | Steady, smooth reveal — no visible lurching on bursts; the caret tracks the reveal head; finishes promptly when the stream ends | K1 |
| 2 | Scroll while reading | Claude.ai | While a turn streams, scroll up to read earlier content; then tap "jump to latest" | Streaming never yanks the scroll while you read above; the pin releases the instant you scroll up; returning to bottom is one smooth eased action | K2 |
| 3 | Expand / entry / state motion | Claude.ai / Basedash | Expand a tool card and a reasoning block; watch a turn's cards mount and a call go running → completed | Sustained ~60fps, no layout thrash in the trace; cards animate in (never pop); the running→completed flip reads as a transition | K3, I1, I8, I9 |
| 4 | Send-to-feedback latency | Basedash | Press Enter on a message | Composer clears, the user bubble and a thinking state appear with no perceptible delay (<100ms); a failed send keeps the message with a Retry, never a dead lag | K4 |
| 5 | Interruption / Stop | Claude.ai | Click Stop mid-stream; close the tab mid-stream | Stop ends streaming within ~1s and the buffered text flushes in full (no clipped tail); the thread is left coherent | A3, K1 |
| 6 | Cross-surface consistency | — | Repeat 1–5 in Spotlight, the item thread, and sprint chat | The feel is identical across all three; no surface is a notch behind | all K |

## Sign-off log

| Date | Reviewer | Dimensions reviewed | Result | Gaps logged |
|------|----------|---------------------|--------|-------------|
| 2026-05-30 | P5.c implementation (code-level) | 1–6 | Implemented; live side-by-side recording pending human review | See notes below |

### P5.c implementation notes (what landed, what a human must still confirm)

This PR implements the mechanisms each dimension depends on. The
screen-recording side-by-side (dimensions 1–6) is the human gate and must be
run on a deployed build before final sign-off; it cannot be produced from CI.

- **D1 (K1)** — streaming now flows through a reveal buffer (`useRevealBuffer`
  + the pure, unit-tested `nextRevealLength` rate). Deltas are paced out by a
  `requestAnimationFrame` loop at an adaptive rate that speeds up under backlog
  and never stalls; the stream flushes in full on completion and on Stop.
  Reduced-motion renders deltas immediately (unchanged from before).
- **D2 (K2)** — the conversation pins to the bottom while streaming and
  releases on scroll-up (via `use-stick-to-bottom`); the "jump to latest"
  button now animates in (`.mashi-enter`), presses on tap (`.mashi-press`),
  carries an `aria-label`, and eases the view back down.
- **D3 (K3)** — performance budget documented in AGENTS.md and enforced by
  `audit:motion` (bans `transition-[height|width|…]` and `animate-collapsible-*`
  on the agent surface). The one layout-animating control (undo-strip countdown)
  now animates `transform: scaleX` instead of `width`. Tool-card / reasoning
  expand already use transform/opacity slide+fade, not animated height.
- **D4 (K4)** — the composer already clears optimistically and renders the user
  bubble + thinking state instantly; a failed send now keeps its message with a
  one-click **Retry** instead of dropping it, and the composer autosizes to
  multi-line drafts without shrinking below its at-rest height.
- **D5 (A3)** — Stop (A3) flushes the reveal buffer so the partial answer shows
  in full before the live view tears down.

Open the deployed agent surface beside Claude.ai / Basedash and walk
dimensions 1–6; log any gap above and bounce on a notch below the reference.
