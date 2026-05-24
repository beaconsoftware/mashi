/**
 * Tiny structured logger. Emits one JSON object per line so Vercel /
 * Datadog can index by field without a parser.
 *
 * Shape: { t: <iso>, lvl: "info"|"warn"|"error", event: <string>, ...ctx }
 *
 * Use sparingly — this is for ops-visible events (rate-limit hits, matcher
 * skips, ingestion failures), not for every render path. Don't replace
 * console.* across the whole codebase; new code in src/lib/activity and
 * the activity API routes uses it.
 */

type Ctx = Record<string, unknown>;

function emit(lvl: "info" | "warn" | "error", event: string, ctx?: Ctx): void {
  const line = JSON.stringify({
    t: new Date().toISOString(),
    lvl,
    event,
    ...(ctx ?? {}),
  });
  if (lvl === "error") console.error(line);
  else if (lvl === "warn") console.warn(line);
  else console.info(line);
}

export const log = {
  info: (event: string, ctx?: Ctx) => emit("info", event, ctx),
  warn: (event: string, ctx?: Ctx) => emit("warn", event, ctx),
  error: (event: string, ctx?: Ctx) => emit("error", event, ctx),
};
