"use client";

import { useSprintStore, type SprintBlock } from "@/store/sprint-store";
import type { S2DItem, Pathway } from "@/types";

/**
 * Sprint pre-warm scheduler.
 *
 * Client-side dispatcher that POSTs to /api/sprint/prewarm for the
 * pathway-specific work that should be in flight before the user lands
 * in the slot. The route fills the appropriate enriched_context field
 * (reply_draft, decision_brief, heads_down_plan, talking_points,
 * signals_since_last, nudge_draft) and the canvas — already polling
 * enriched_context — picks it up automatically.
 *
 * Behavior:
 *   - Per-block dedupe via an in-flight Map keyed on block.s2dItemId.
 *     Repeated calls while a warm is in flight are no-ops.
 *   - Updates the store's prewarm_status: pending → warming → ready
 *     (or `failed` with prewarm_error).
 *   - decision_gate is gated on block.prewarm_opt_in; otherwise the
 *     status flips to `skipped` immediately and no POST is made.
 *
 * Triggers (caller is responsible for invoking):
 *   - startSprint: warm slots 1..MAX_PARALLEL_SLOTS immediately.
 *   - tick: when an active slot crosses 90% of its duration AND the
 *     queue has items, warm queue[0] (deduped by
 *     block.prewarm_queued_soon_fired).
 *   - completeBlock: if a queued block was promoted into a freed slot
 *     and its prewarm_status is `pending` (i.e., never warmed), warm
 *     now. (Most promotions will already be `ready` from the 90%
 *     queued-soon signal.)
 *   - repathway: mark prewarm_status `pending` and call again with
 *     reason="repathway" so we replace stale content.
 */

const inFlight = new Map<string, Promise<void>>();

export type PrewarmReason = "activate" | "queued-soon" | "repathway";

interface ScheduleOpts {
  block: SprintBlock;
  item: S2DItem;
  reason: PrewarmReason;
}

export function schedulePrewarm({ block, item, reason }: ScheduleOpts): void {
  const key = `${block.s2dItemId}:${reason}`;
  if (inFlight.has(key)) return;

  // Decision-gate is opt-in. Mark skipped immediately rather than
  // burning a token call.
  if (item.pathway === "decision_gate" && !block.prewarm_opt_in) {
    useSprintStore.getState().setPrewarm(block.s2dItemId, {
      prewarm_status: "skipped",
      prewarm_completed_at: new Date().toISOString(),
      prewarm_error: null,
    });
    return;
  }

  // Re-pathway: nuke prior status before kicking off so the canvas
  // doesn't reuse stale content while the new warm is in flight.
  if (reason === "repathway") {
    useSprintStore.getState().setPrewarm(block.s2dItemId, {
      prewarm_status: "pending",
      prewarm_completed_at: null,
      prewarm_error: null,
      prewarm_queued_soon_fired: false,
    });
  }

  // Pending → warming. The canvas reads this via the polling-hook in
  // use-enriched-context to know whether to keep polling.
  useSprintStore.getState().setPrewarm(block.s2dItemId, {
    prewarm_status: "warming",
    prewarm_error: null,
  });

  const promise = (async () => {
    try {
      const res = await fetch("/api/sprint/prewarm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: item.id,
          pathway: item.pathway as Pathway,
          reason,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(
          (j as { error?: string }).error ?? `prewarm ${res.status}`
        );
      }
      useSprintStore.getState().setPrewarm(block.s2dItemId, {
        prewarm_status: "ready",
        prewarm_completed_at: new Date().toISOString(),
        prewarm_error: null,
      });
    } catch (err) {
      useSprintStore.getState().setPrewarm(block.s2dItemId, {
        prewarm_status: "failed",
        prewarm_error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, promise);
}

/**
 * Debounce wrapper: many callers (timer ticks, slot promotions) might
 * call schedulePrewarm in tight bursts. The in-flight Map dedupes by
 * key, but a 50ms debounce on the warm fire-fan-out keeps the network
 * tab calm under store-tick chatter. Exported so tests can flush.
 */
const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function schedulePrewarmDebounced(opts: ScheduleOpts, delay = 50): void {
  const key = `${opts.block.s2dItemId}:${opts.reason}`;
  const prior = pendingTimers.get(key);
  if (prior) clearTimeout(prior);
  const t = setTimeout(() => {
    pendingTimers.delete(key);
    schedulePrewarm(opts);
  }, delay);
  pendingTimers.set(key, t);
}

/** Test-only escape hatch — flush every pending debounce immediately. */
export function __flushPrewarmDebounce(): void {
  for (const [key, t] of pendingTimers.entries()) {
    clearTimeout(t);
    pendingTimers.delete(key);
  }
}
