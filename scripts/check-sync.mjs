import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

for (const line of readFileSync(resolve(process.cwd(), ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
  if (!m) continue;
  if (!process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
}

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const SIDD = "94bcc978-6b26-4c34-b3e1-231372c330cd";

const { data, error } = await sb
  .from("connected_accounts")
  .select("provider, account_label, last_synced_at, last_sync_status, last_sync_error, updated_at")
  .eq("user_id", SIDD)
  .order("provider");
if (error) { console.error(error); process.exit(1); }
console.log("Provider".padEnd(12), "Status".padEnd(10), "Last sync".padEnd(25), "Error");
console.log("-".repeat(120));
for (const c of data) {
  const label = `${c.provider}/${(c.account_label || "?").slice(0, 20)}`;
  console.log(
    label.padEnd(28),
    (c.last_sync_status ?? "—").padEnd(10),
    (c.last_synced_at ?? "—").slice(0, 19).padEnd(25),
    (c.last_sync_error ?? "").slice(0, 80)
  );
}
