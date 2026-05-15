// End-to-end test of the onboarding flow against the local dev server.
// Creates a test user, signs them in, walks through every step, asserts
// state at each transition.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "http://127.0.0.1:54321";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP_URL = "http://localhost:3456";
const EMAIL = `flowtest+${Date.now()}@beaconsoftware.com`;
const PASSWORD = "test-password-12345";

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// 1. Create a user via admin (bypasses email confirmation)
console.log("1. Creating test user", EMAIL);
const { data: created, error: createErr } = await admin.auth.admin.createUser({
  email: EMAIL,
  password: PASSWORD,
  email_confirm: true,
});
if (createErr) {
  console.error("CREATE FAILED:", createErr.message);
  process.exit(1);
}
const userId = created.user.id;
console.log("   user.id =", userId);

// 2. Check user_profile was auto-created
const { data: profile1 } = await admin
  .from("user_profile")
  .select("user_id, onboarding_step, onboarded_at")
  .eq("user_id", userId)
  .maybeSingle();
console.log("2. user_profile after signup:", profile1);
if (!profile1) {
  console.error("   FAIL: user_profile not created by trigger");
  process.exit(1);
}

// 3. Sign in as the user to get a session
const anon = createClient(SUPABASE_URL, ANON_KEY);
const { data: signIn, error: signInErr } = await anon.auth.signInWithPassword({
  email: EMAIL,
  password: PASSWORD,
});
if (signInErr) {
  console.error("SIGN IN FAILED:", signInErr.message);
  process.exit(1);
}
const accessToken = signIn.session.access_token;
const refreshToken = signIn.session.refresh_token;
console.log("3. Signed in. Access token length:", accessToken.length);

// Cookie naming per supabase-js index.mjs:373 →
//   sb-${hostname.split(".")[0]}-auth-token = `base64-${b64(json)}`
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
  const encoded = `base64-${Buffer.from(JSON.stringify(session)).toString("base64")}`;
  return `sb-${ref}-auth-token=${encoded}`;
}

// 4. POST /api/onboard/step { step: N } for each step
for (let step = 2; step <= 6; step++) {
  const res = await fetch(`${APP_URL}/api/onboard/step`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookieHeader(),
    },
    body: JSON.stringify({ step }),
  });
  const text = await res.text();
  console.log(`4.${step} POST /api/onboard/step {step:${step}} → ${res.status}: ${text.slice(0, 200)}`);

  // Verify the DB updated
  const { data: profileN } = await admin
    .from("user_profile")
    .select("onboarding_step, onboarded_at")
    .eq("user_id", userId)
    .maybeSingle();
  console.log(`   DB now: step=${profileN?.onboarding_step}, onboarded_at=${profileN?.onboarded_at ? "set" : "null"}`);
  if (profileN?.onboarding_step !== step) {
    console.error(`   ❌ FAIL: expected step=${step}, got ${profileN?.onboarding_step}`);
  }
}

// 5. Now hit "/" — middleware should NOT redirect us to /onboard
const homeRes = await fetch(`${APP_URL}/`, {
  redirect: "manual",
  headers: { Cookie: cookieHeader() },
});
console.log(`5. GET / → ${homeRes.status} (location: ${homeRes.headers.get("location") ?? "—"})`);
if (homeRes.status >= 300 && homeRes.status < 400) {
  const loc = homeRes.headers.get("location") ?? "";
  if (loc.includes("/onboard")) {
    console.error("   ❌ BUG REPRODUCED: GET / redirected to /onboard despite onboarding_step=6 + onboarded_at set");
  } else {
    console.log("   ↪ redirect to", loc, "(not /onboard — probably fine)");
  }
} else {
  console.log("   ✓ no redirect — onboarding gate honored");
}

// Cleanup
await admin.auth.admin.deleteUser(userId);
console.log("6. cleanup ✓");
