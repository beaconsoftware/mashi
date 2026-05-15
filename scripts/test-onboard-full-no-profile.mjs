// Full simulation of Matt's reported bug: user has no user_profile row,
// walks all 6 steps clicking Continue. With the fix, each step upserts
// and the final GET / does NOT redirect to /onboard.
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "http://127.0.0.1:54321";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP_URL = "http://localhost:3456";
const EMAIL = `fullnoprof+${Date.now()}@beaconsoftware.com`;
const PASSWORD = "test-password-12345";

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: created } = await admin.auth.admin.createUser({
  email: EMAIL,
  password: PASSWORD,
  email_confirm: true,
});
const userId = created.user.id;
console.log("user_id =", userId);

// Simulate the bug: profile row missing
await admin.from("user_profile").delete().eq("user_id", userId);
console.log("profile deleted to simulate trigger-didn't-fire scenario");

const anon = createClient(SUPABASE_URL, ANON_KEY);
const { data: signIn } = await anon.auth.signInWithPassword({
  email: EMAIL,
  password: PASSWORD,
});
const accessToken = signIn.session.access_token;
const refreshToken = signIn.session.refresh_token;

function cookieHeader() {
  const ref = new URL(SUPABASE_URL).hostname.split(".")[0];
  const session = {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: signIn.session.expires_at,
    expires_in: signIn.session.expires_in,
    token_type: "bearer",
    user: signIn.user,
  };
  return `sb-${ref}-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString("base64")}`;
}

// Walk every step like a real user would
let failed = false;
for (let step = 2; step <= 6; step++) {
  const res = await fetch(`${APP_URL}/api/onboard/step`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookieHeader() },
    body: JSON.stringify({ step }),
  });
  const body = await res.text();
  const { data: db } = await admin
    .from("user_profile")
    .select("onboarding_step, onboarded_at")
    .eq("user_id", userId)
    .maybeSingle();
  const ok = db?.onboarding_step === step;
  console.log(
    `step=${step}: api=${res.status} ${body.slice(0, 60)} | db.step=${db?.onboarding_step} | onboarded_at=${db?.onboarded_at ? "set" : "null"} ${ok ? "✓" : "✗"}`
  );
  if (!ok) failed = true;
}

const homeRes = await fetch(`${APP_URL}/`, {
  redirect: "manual",
  headers: { Cookie: cookieHeader() },
});
const loc = homeRes.headers.get("location") ?? "—";
console.log(`GET / → ${homeRes.status} (location: ${loc})`);
if (homeRes.status >= 300 && loc.includes("/onboard")) {
  console.log("❌ STILL LOOPING — bug not fully fixed");
  failed = true;
} else {
  console.log("✓ No /onboard redirect at the end");
}

await admin.auth.admin.deleteUser(userId);
console.log(failed ? "\nFAILED" : "\nPASS");
process.exit(failed ? 1 : 0);
