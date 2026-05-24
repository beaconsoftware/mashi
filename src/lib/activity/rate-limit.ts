/**
 * Per-token rate limiter for /api/activity/heartbeat.
 *
 * Goal: stop a runaway feeder from flooding activity_events with millions
 * of rows. A well-behaved feeder hearbeats at ~1/min on focus changes; a
 * buggy loop could easily fire 100/s.
 *
 * Algorithm: simple fixed-window counter, 60 events per token per minute.
 * Counts EVENTS, not requests — a single 100-event batch counts as 100.
 *
 * State: in-memory Map keyed by tokenId. No DB persistence — a serverless
 * cold start resets every bucket, which is fine: the worst case is a
 * misbehaving client gets a fresh 60-event budget after a deploy, which
 * is still vastly better than no limit at all. If we ever need cross-
 * instance enforcement, swap this for Redis / Upstash without changing
 * callers.
 *
 * Session-auth callers (web app reads) skip rate limiting — those are
 * low-volume and have a real user behind them.
 */

import { log } from "@/lib/log";

const WINDOW_MS = 60 * 1000;
const LIMIT_PER_WINDOW = 60;

interface Bucket {
  count: number;
  /** ms epoch when the current window started */
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the window resets. Populated when !allowed. */
  retryAfterSec: number;
  /** Remaining budget in the current window, after this charge if allowed. */
  remaining: number;
}

/**
 * Charge `eventCount` against the bucket for `tokenId`. If the charge would
 * exceed the per-minute limit, return allowed=false WITHOUT incrementing
 * (so a denied request doesn't push the bucket further into the red).
 */
export function checkRateLimit(
  tokenId: string,
  eventCount: number
): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(tokenId);

  // New window if no bucket or the prior window has elapsed.
  if (!existing || now - existing.windowStart >= WINDOW_MS) {
    if (eventCount > LIMIT_PER_WINDOW) {
      // Single batch alone exceeds the per-window budget. Deny.
      log.warn("activity_rate_limit.batch_exceeds_window", {
        token_id_prefix: tokenId.slice(0, 8),
        event_count: eventCount,
        limit: LIMIT_PER_WINDOW,
      });
      return {
        allowed: false,
        retryAfterSec: Math.ceil(WINDOW_MS / 1000),
        remaining: 0,
      };
    }
    buckets.set(tokenId, { count: eventCount, windowStart: now });
    return {
      allowed: true,
      retryAfterSec: 0,
      remaining: LIMIT_PER_WINDOW - eventCount,
    };
  }

  if (existing.count + eventCount > LIMIT_PER_WINDOW) {
    const retryAfterSec = Math.max(
      1,
      Math.ceil((WINDOW_MS - (now - existing.windowStart)) / 1000)
    );
    log.warn("activity_rate_limit.exceeded", {
      token_id_prefix: tokenId.slice(0, 8),
      current_count: existing.count,
      event_count: eventCount,
      limit: LIMIT_PER_WINDOW,
      retry_after_sec: retryAfterSec,
    });
    return { allowed: false, retryAfterSec, remaining: 0 };
  }

  existing.count += eventCount;
  return {
    allowed: true,
    retryAfterSec: 0,
    remaining: LIMIT_PER_WINDOW - existing.count,
  };
}

/** Test-only — wipe the in-memory state. Not used in prod code paths. */
export function __resetRateLimitForTests(): void {
  buckets.clear();
}
