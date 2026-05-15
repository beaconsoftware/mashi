/**
 * One-off: run a full reconcile pass against the local DB. Bypasses the
 * /api/reconcile route auth so we can sweep stale items from the CLI.
 *
 *   npx tsx scripts/run-reconcile.ts
 */
// Hand-load .env.local since this runs outside Next.js's env machinery.
// Must happen BEFORE any imports that read env at module-init time
// (Anthropic client, Supabase service client). Hence dynamic imports below.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
for (const line of readFileSync(resolve(process.cwd(), ".env.local"), "utf8").split(
  "\n"
)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
  if (!m) continue;
  const [, k, v] = m;
  if (!process.env[k]) process.env[k] = v.replace(/^"(.*)"$/, "$1");
}

async function main() {
  const { reconcileAllStatuses } = await import("../src/lib/triage/reconcile");
  console.log("Running reconcile…");
  const r = await reconcileAllStatuses();
  console.log(JSON.stringify(r, null, 2));
}

void main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
