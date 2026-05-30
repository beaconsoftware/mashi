/**
 * A4 — transient-error classification + backoff for the agent loop.
 *
 * Pure, side-effect-free helpers so they're unit-testable in isolation
 * (see `__tests__/retry.test.ts`). The loop wraps each model call in a
 * bounded retry: a connect-time transient error (429 / 5xx / network) is
 * retried with jittered exponential backoff; once any text has streamed
 * we stop retrying (avoid double-billing / duplicated output) and instead
 * preserve the partial text (A8) and surface a Retry affordance.
 *
 * The Anthropic SDK already retries the *initial* connect a couple of
 * times (default maxRetries 2 on 429/5xx/network). This layer adds an
 * app-level retry around the whole stream attempt so a drop the SDK gives
 * up on doesn't silently end the turn.
 */

/** Max app-level retries of a model call within a single loop iteration. */
export const MAX_STREAM_RETRIES = 2;

/** Base backoff (ms) for the first retry. Doubles each attempt. */
const BASE_BACKOFF_MS = 500;
/** Ceiling so a high attempt count can't sleep absurdly long. */
const MAX_BACKOFF_MS = 8_000;

/** HTTP statuses we treat as transient (worth retrying). */
const TRANSIENT_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

/** Substrings of network-level error messages that are transient. */
const TRANSIENT_NETWORK_RE =
  /(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|EAI_AGAIN|ENOTFOUND|socket hang up|network|fetch failed|terminated|premature close|aborted by the server)/i;

interface MaybeApiError {
  status?: number;
  statusCode?: number;
  code?: string;
  name?: string;
  message?: string;
  headers?: Record<string, string> | Headers;
}

/**
 * True for errors worth retrying: HTTP 429/5xx-ish, SDK connection
 * errors, or recognizable network blips. A user abort is NOT transient
 * (see `isAbortError`) — the caller checks that first and exits.
 */
export function isTransientError(err: unknown): boolean {
  if (err == null || typeof err !== "object") return false;
  const e = err as MaybeApiError;

  const status = e.status ?? e.statusCode;
  if (typeof status === "number" && TRANSIENT_STATUSES.has(status)) return true;

  // The SDK throws named connection errors that may not carry a status.
  if (
    e.name === "APIConnectionError" ||
    e.name === "APIConnectionTimeoutError" ||
    e.name === "InternalServerError"
  ) {
    return true;
  }

  if (typeof e.code === "string" && TRANSIENT_NETWORK_RE.test(e.code)) {
    return true;
  }
  if (typeof e.message === "string" && TRANSIENT_NETWORK_RE.test(e.message)) {
    return true;
  }
  return false;
}

/**
 * True when the error is a client/user abort (AbortController.abort or a
 * disconnected request signal). These end the turn cleanly; they are
 * never retried and never surfaced as an error.
 */
export function isAbortError(err: unknown): boolean {
  if (err == null || typeof err !== "object") return false;
  const e = err as MaybeApiError;
  if (e.name === "AbortError" || e.name === "APIUserAbortError") return true;
  if (e.code === "ABORT_ERR") return true;
  if (typeof e.message === "string" && /\baborted\b/i.test(e.message)) {
    // Don't swallow the server-side "aborted by the server" blip, which is
    // transient, not a user abort.
    return !/by the server/i.test(e.message);
  }
  return false;
}

/**
 * Jittered exponential backoff for retry `attempt` (1-based). Full jitter
 * (random between 0 and the capped exponential) to avoid thundering-herd
 * alignment across concurrent turns.
 */
export function backoffDelayMs(
  attempt: number,
  rng: () => number = Math.random
): number {
  const exp = Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS);
  return Math.round(rng() * exp);
}

/**
 * If a transient error carries a `retry-after` header (seconds, or an
 * HTTP-date), return the wait in ms; otherwise null so the caller falls
 * back to `backoffDelayMs`.
 */
export function retryAfterMs(err: unknown): number | null {
  if (err == null || typeof err !== "object") return null;
  const h = (err as MaybeApiError).headers;
  if (!h) return null;
  const raw =
    typeof (h as Headers).get === "function"
      ? (h as Headers).get("retry-after")
      : (h as Record<string, string>)["retry-after"];
  if (!raw) return null;
  const secs = Number(raw);
  if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, 60_000);
  const when = Date.parse(raw);
  if (!Number.isNaN(when)) {
    return Math.max(0, Math.min(when - Date.now(), 60_000));
  }
  return null;
}

/**
 * Sleep that resolves early if the signal aborts. Used for both retry
 * backoff and the approval poll so a client disconnect doesn't wait out
 * the full delay before the loop notices it's been cancelled.
 */
export function abortableSleep(
  ms: number,
  signal?: AbortSignal
): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener?.("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener?.("abort", onAbort, { once: true });
  });
}
