"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { nextRevealLength } from "@/lib/agent/reveal";

/**
 * K1 — streaming cadence smoothing.
 *
 * A client-side reveal buffer between the SSE reader and the rendered text.
 * `append(chunk)` adds a just-arrived delta to the target string; a
 * requestAnimationFrame loop reveals characters toward that target at the
 * adaptive rate in `nextRevealLength`, so bursty deltas read as a smooth,
 * steady stream. `flush` reveals everything at once (stream end / Stop);
 * `reset` clears for the next turn.
 *
 * Reduced-motion short-circuits the pacing entirely: deltas render the instant
 * they land, exactly as before the buffer existed.
 */
export function useRevealBuffer(): {
  /** The currently-revealed prefix of the accumulated target. */
  text: string;
  /** Add a just-arrived SSE delta to the target and keep the reveal running. */
  append: (chunk: string) => void;
  /** Reveal the full target immediately (stream completion, Stop). */
  flush: () => void;
  /** Clear the buffer for a new turn. */
  reset: () => void;
} {
  const [text, setText] = useState("");
  // Full accumulated target (everything received so far) and how much of it is
  // currently revealed. Kept in refs so the rAF loop reads live values without
  // re-subscribing; `text` state exists only to trigger re-render.
  const targetRef = useRef("");
  const revealedRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const reduceRef = useRef(false);

  useEffect(() => {
    reduceRef.current =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  const stop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  // Named function expression so the recursive rAF schedules against its own
  // name (`tick`), not the outer `frame` const — keeps the React Compiler happy
  // (no "accessed before declared") while still self-scheduling each frame.
  const frame = useCallback(function tick() {
    const next = nextRevealLength(revealedRef.current, targetRef.current.length);
    revealedRef.current = next;
    setText(targetRef.current.slice(0, next));
    if (next >= targetRef.current.length) {
      rafRef.current = null;
      return;
    }
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const append = useCallback(
    (chunk: string) => {
      if (!chunk) return;
      targetRef.current += chunk;
      if (reduceRef.current) {
        // No pacing for reduced-motion users: render the delta immediately.
        revealedRef.current = targetRef.current.length;
        setText(targetRef.current);
        return;
      }
      if (rafRef.current === null) rafRef.current = requestAnimationFrame(frame);
    },
    [frame]
  );

  const flush = useCallback(() => {
    stop();
    revealedRef.current = targetRef.current.length;
    setText(targetRef.current);
  }, [stop]);

  const reset = useCallback(() => {
    stop();
    targetRef.current = "";
    revealedRef.current = 0;
    setText("");
  }, [stop]);

  // Cancel any in-flight frame on unmount so a backgrounded turn's reveal loop
  // doesn't outlive the component.
  useEffect(() => () => stop(), [stop]);

  return { text, append, flush, reset };
}
