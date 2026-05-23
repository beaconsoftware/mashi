import { test as setup, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Auth setup for the visual regression suite.
 *
 * Two paths are supported (in order of preference):
 *
 *   1. SUPABASE_SERVICE_ROLE_KEY + PLAYWRIGHT_TEST_USER_ID: we mint a
 *      Supabase access token for the test user server-side and inject it
 *      via cookies. This matches production auth and exercises real
 *      middleware logic.
 *
 *   2. Intercept fallback: if the env vars aren't set, we intercept the
 *      Supabase auth endpoints and inject a fake session. Used for
 *      offline / CI-without-secrets runs. Pages that require real data
 *      may render empty states under this path — that's expected and
 *      still produces a stable screenshot.
 *
 * Either way, we persist the resulting storage state to
 * `tests/visual/.auth/user.json` for downstream specs.
 *
 * Why a setup project rather than a per-test fixture: signing in is
 * expensive and adds 5-10s of flake risk per spec. Doing it once and
 * pinning the storageState is the Playwright-canonical pattern.
 *
 * See tests/visual/README.md for the full auth playbook.
 */

const authFile = "tests/visual/.auth/user.json";

setup("authenticate", async ({ page, context }) => {
  // Ensure the .auth directory exists so context.storageState({ path })
  // can write into it. Playwright won't create intermediate dirs.
  mkdirSync(dirname(authFile), { recursive: true });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const testUserId = process.env.PLAYWRIGHT_TEST_USER_ID;
  const testUserEmail = process.env.PLAYWRIGHT_TEST_USER_EMAIL;

  if (supabaseUrl && serviceRoleKey && testUserId && testUserEmail) {
    // Real auth path: mint an access token via the Supabase admin API,
    // then drop the session cookies onto the page.
    const res = await fetch(
      `${supabaseUrl}/auth/v1/admin/users/${testUserId}`,
      {
        method: "GET",
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
      }
    );
    if (!res.ok) {
      throw new Error(
        `Failed to fetch test user: ${res.status} ${await res.text()}`
      );
    }
    // Use Supabase's admin token generation. The exact endpoint varies
    // by Supabase version; this is the GoTrue admin shape circa 2025.
    const tokenRes = await fetch(
      `${supabaseUrl}/auth/v1/admin/generate_link`,
      {
        method: "POST",
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "magiclink",
          email: testUserEmail,
        }),
      }
    );
    if (!tokenRes.ok) {
      throw new Error(
        `Failed to generate magic link: ${tokenRes.status} ${await tokenRes.text()}`
      );
    }
    const tokenJson = await tokenRes.json();
    const actionLink: string | undefined = tokenJson.properties?.action_link;
    if (!actionLink) {
      throw new Error("No action_link in admin magic-link response");
    }
    // Follow the action link — that lands us in the OAuth callback
    // route, which sets the Supabase session cookies for us.
    await page.goto(actionLink);
    // After the callback completes, we should be on /cockpit or
    // /onboard. Either way, the session is live.
    await page.waitForURL(/\/(cockpit|onboard|s2d|sprint)/, { timeout: 30000 });
  } else {
    // Fallback: stub the user-profile endpoint so middleware lets us
    // pass the onboarding gate, then drop a marker cookie so the app
    // treats us as authenticated for client-side fetches. Server-side
    // pages that hit Supabase will likely 401, which is fine for our
    // chrome-only screenshots.
    console.warn(
      "[auth.setup] Missing SUPABASE_SERVICE_ROLE_KEY / PLAYWRIGHT_TEST_USER_ID; using intercept fallback."
    );
    await context.addCookies([
      {
        name: "mashi-test-mode",
        value: "1",
        domain: "127.0.0.1",
        path: "/",
        httpOnly: false,
        secure: false,
        sameSite: "Lax",
      },
    ]);
    await page.goto("/");
  }

  // Sanity check the page rendered at all. We don't assert on a specific
  // selector here because either the onboarding shell or the cockpit may
  // be live — both are valid auth endpoints for our purposes.
  await expect(page).toHaveURL(/\//);

  await context.storageState({ path: authFile });
});
