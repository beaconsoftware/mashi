/**
 * A4 — unit tests for transient-error classification + backoff.
 *
 * Self-running assertion script (no test framework, matching the
 * convention in replay.test.ts / pricing.test.ts). Runs with:
 *   pnpm test:retry
 *
 * Covers the classifier boundaries (what is retried vs. surfaced), the
 * abort/transient disambiguation, retry-after parsing, jittered backoff
 * bounds, and the abortable sleep resolving early on abort.
 */
import {
  MAX_STREAM_RETRIES,
  abortableSleep,
  backoffDelayMs,
  isAbortError,
  isTransientError,
  retryAfterMs,
} from "@/lib/agent/retry";

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

function testTransientClassification() {
  console.log("isTransientError");
  assert(isTransientError({ status: 429 }), "429 is transient");
  assert(isTransientError({ status: 503 }), "503 is transient");
  assert(isTransientError({ status: 500 }), "500 is transient");
  assert(isTransientError({ statusCode: 502 }), "502 (statusCode) is transient");
  assert(
    isTransientError({ name: "APIConnectionError" }),
    "APIConnectionError is transient"
  );
  assert(
    isTransientError({ message: "fetch failed" }),
    "network 'fetch failed' is transient"
  );
  assert(
    isTransientError({ code: "ECONNRESET" }),
    "ECONNRESET is transient"
  );
  assert(!isTransientError({ status: 400 }), "400 is NOT transient");
  assert(!isTransientError({ status: 401 }), "401 is NOT transient");
  assert(!isTransientError({ status: 404 }), "404 is NOT transient");
  assert(!isTransientError(null), "null is NOT transient");
  assert(!isTransientError("boom"), "string is NOT transient");
}

function testAbortClassification() {
  console.log("isAbortError");
  assert(isAbortError({ name: "AbortError" }), "AbortError is an abort");
  assert(
    isAbortError({ name: "APIUserAbortError" }),
    "APIUserAbortError is an abort"
  );
  assert(isAbortError({ code: "ABORT_ERR" }), "ABORT_ERR is an abort");
  assert(
    isAbortError({ message: "The operation was aborted" }),
    "'aborted' message is an abort"
  );
  assert(
    !isAbortError({ message: "aborted by the server" }),
    "'aborted by the server' is a transient blip, not a user abort"
  );
  assert(
    isTransientError({ message: "aborted by the server" }),
    "'aborted by the server' is classified transient"
  );
  assert(!isAbortError({ status: 503 }), "a 503 is not an abort");
}

function testRetryAfter() {
  console.log("retryAfterMs");
  assert(
    retryAfterMs({ headers: { "retry-after": "2" } }) === 2000,
    "numeric retry-after seconds → ms"
  );
  assert(retryAfterMs({ headers: {} }) === null, "no header → null");
  assert(retryAfterMs({}) === null, "no headers → null");
  // Headers-object form (has a .get).
  const h = new Map<string, string>([["retry-after", "3"]]);
  const headersLike = { get: (k: string) => h.get(k) ?? null };
  assert(
    retryAfterMs({ headers: headersLike as unknown as Headers }) === 3000,
    "Headers.get form → ms"
  );
}

function testBackoff() {
  console.log("backoffDelayMs");
  // Full jitter: result is in [0, capped exponential]. rng=1 hits the ceiling.
  const a1 = backoffDelayMs(1, () => 1);
  const a2 = backoffDelayMs(2, () => 1);
  const a3 = backoffDelayMs(3, () => 1);
  assert(a1 === 500, "attempt 1 ceiling = 500ms");
  assert(a2 === 1000, "attempt 2 ceiling = 1000ms");
  assert(a3 === 2000, "attempt 3 ceiling = 2000ms");
  assert(backoffDelayMs(1, () => 0) === 0, "rng=0 → 0ms (full jitter floor)");
  assert(
    backoffDelayMs(20, () => 1) === 8000,
    "high attempt clamps at the 8s cap"
  );
  assert(MAX_STREAM_RETRIES >= 1, "at least one retry is configured");
}

async function testAbortableSleep() {
  console.log("abortableSleep");
  const t0 = Date.now();
  await abortableSleep(20);
  assert(Date.now() - t0 >= 15, "sleeps about the requested duration");

  const ac = new AbortController();
  const started = Date.now();
  const p = abortableSleep(10_000, ac.signal);
  ac.abort();
  await p;
  assert(Date.now() - started < 1_000, "resolves early when aborted");

  const pre = new AbortController();
  pre.abort();
  const t1 = Date.now();
  await abortableSleep(10_000, pre.signal);
  assert(Date.now() - t1 < 1_000, "already-aborted signal resolves immediately");
}

async function main() {
  console.log("agent retry/backoff guard\n");
  testTransientClassification();
  testAbortClassification();
  testRetryAfter();
  testBackoff();
  await testAbortableSleep();

  console.log(`\n${stats.pass} passed, ${stats.fail} failed`);
  if (stats.fail > 0) process.exit(1);
}

void main();
