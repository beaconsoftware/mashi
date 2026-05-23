import { test, expect, type Page } from "@playwright/test";

/**
 * Dashboard chrome smoke tests.
 *
 * Each spec navigates to a dashboard route, waits for the first big
 * paint to settle, and snapshots the viewport. The goal is to catch
 * structural layout regressions (z-stacking bugs, invisible chrome,
 * sidebar overlap, etc) introduced by primitive churn — not to validate
 * pixel-perfect content. We mask data-driven regions so a row count
 * change in S2D doesn't fire a screenshot diff.
 *
 * Specifically, the S2D column-header smoke test is the load-bearing
 * one: regression of the "column header invisible against album-art"
 * bug would have produced a diff against the baseline since the
 * headers should now render as a visible <SectionHeader> chrome strip.
 */

const ROUTES: { path: string; name: string }[] = [
  { path: "/cockpit", name: "cockpit" },
  { path: "/s2d", name: "s2d-board" },
  { path: "/sprint", name: "sprint-idle" },
  { path: "/inbox", name: "inbox" },
  { path: "/calendar", name: "calendar" },
  { path: "/notes", name: "notes" },
  { path: "/linear", name: "linear" },
  { path: "/companies", name: "companies" },
  { path: "/settings/connections", name: "settings-connections" },
  { path: "/settings/style", name: "settings-style" },
];

async function settle(page: Page) {
  // Wait for any GSAP entry tweens to land before snapshotting.
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(600);
}

for (const route of ROUTES) {
  test(`route screenshot: ${route.name}`, async ({ page }) => {
    await page.goto(route.path);
    await settle(page);
    await expect(page).toHaveScreenshot(`${route.name}.png`, {
      fullPage: false,
      // Mask the user-data-driven regions so screenshot stability
      // doesn't depend on what's in the test user's account.
      mask: [
        page.locator("[data-test-mask]"),
        page.locator("img[alt='album art']"),
      ],
    });
  });
}

test("s2d: spotify queue dropdown open", async ({ page }) => {
  await page.goto("/s2d");
  await settle(page);
  // The Spotify queue dropdown trigger lives on the chrome bar. If the
  // user isn't connected to Spotify the trigger is absent — guard so
  // the test is a no-op rather than a flake.
  const trigger = page.getByRole("button", { name: /queue/i });
  if ((await trigger.count()) === 0) {
    test.skip(true, "Spotify not connected in this fixture");
  }
  await trigger.first().click();
  await page.waitForTimeout(300);
  await expect(page).toHaveScreenshot("s2d-queue-open.png", {
    fullPage: false,
  });
});

test("sprint: active mode with one slot", async ({ page }) => {
  await page.goto("/sprint");
  await settle(page);
  // We can't easily seed a real active sprint without DB access from
  // the test harness; if the idle splash is visible we skip and rely
  // on the route-level baseline for /sprint instead.
  const startButton = page.getByRole("button", { name: /start planning/i });
  if ((await startButton.count()) > 0) {
    test.skip(true, "Sprint active state requires seeded data");
  }
  await expect(page).toHaveScreenshot("sprint-active.png", {
    fullPage: false,
  });
});
