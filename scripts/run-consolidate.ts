// Mirror of scripts/run-reconcile.ts but for the consolidate pass.
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
  const userId = process.argv[2];
  if (!userId) {
    console.error("usage: tsx scripts/run-consolidate.ts <user-id>");
    process.exit(2);
  }
  const { consolidateDuplicates } = await import("../src/lib/triage/consolidate");
  console.log("Running consolidate for", userId);
  const r = await consolidateDuplicates(userId);
  console.log(JSON.stringify(r, null, 2));
}

void main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
