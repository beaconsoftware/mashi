/**
 * Trigger a single connection's sync against whatever Supabase the env
 * points to. Useful for verifying a fix without going through the UI.
 *
 *   pnpm tsx scripts/run-sync-one.ts <provider> <connection_id>
 *
 * Pulls env from .env.local; for prod runs, pipe `vercel env pull` over
 * top first.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

for (const line of readFileSync(resolve(process.cwd(), ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
  if (!m) continue;
  const [, k, v] = m;
  if (!process.env[k]) process.env[k] = v.replace(/^"(.*)"$/, "$1");
}

async function main() {
  const provider = process.argv[2];
  const connectionId = process.argv[3];
  if (!provider || !connectionId) {
    console.error("usage: tsx scripts/run-sync-one.ts <provider> <connection_id>");
    process.exit(2);
  }

  let result: unknown;
  if (provider === "linear") {
    const { syncLinearConnection } = await import("../src/lib/sync/linear-sync");
    result = await syncLinearConnection(connectionId);
  } else if (provider === "gmail") {
    const { syncGmailConnection } = await import("../src/lib/sync/gmail-sync");
    result = await syncGmailConnection(connectionId);
  } else if (provider === "gcal") {
    const { syncGCalConnection } = await import("../src/lib/sync/gcal-sync");
    result = await syncGCalConnection(connectionId);
  } else if (provider === "slack") {
    const { syncSlackConnection } = await import("../src/lib/sync/slack-sync");
    result = await syncSlackConnection(connectionId);
  } else if (provider === "fireflies") {
    const { syncFirefliesConnection } = await import("../src/lib/sync/fireflies-sync");
    result = await syncFirefliesConnection(connectionId);
  } else {
    console.error(`unknown provider: ${provider}`);
    process.exit(2);
  }
  console.log(JSON.stringify(result, null, 2));
}

void main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("FAIL:", e);
    process.exit(1);
  });
