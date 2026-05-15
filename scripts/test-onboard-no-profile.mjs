// Test what happens when user_profile row is missing (trigger didn't fire,
// or migration left it without user_id). The API should error loudly, not
// silently no-op.
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "http://127.0.0.1:54321";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP_URL = "http://localhost:3456";
const EMAIL = `noprof+${Date.now()}@beaconsoftware.com`;
const PASSWORD = "test-password-12345";

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// 1. Create user (trigger creates profile)
const { data: created } = await admin.auth.admin.createUser({
  email: EMAIL,
  password: PASSWORD,
  email_confirm: true,
});
const userId = created.user.id;
console.log("created user_id =", userId);

// 2. DELETE the profile row to simulate the failure mode
await admin.from("user_profile").delete().eq("user_id", userId);
const { data: gone } = await admin
  .from("user_profile")
  .select("user_id")
  .eq("user_id", userId);
console.log("profile rows after delete =", gone?.length);

// 3. Sign in to get a session
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
  const encoded = `base64-${Buffer.from(JSON.stringify(session)).toString("base64")}`;
  return `sb-${ref}-auth-token=${encoded}`;
}

// 4. POST advance — with no profile row
const res = await fetch(`${APP_URL}/api/onboard/step`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Cookie: cookieHeader() },
  body: JSON.stringify({ step: 2 }),
});
const body = await res.text();
console.log(`POST /api/onboard/step → ${res.status}: ${body}`);

const { data: postProfile } = await admin
  .from("user_profile")
  .select("user_id, onboarding_step")
  .eq("user_id", userId);
console.log("profile rows AFTER POST =", postProfile);

await admin.auth.admin.deleteUser(userId);
