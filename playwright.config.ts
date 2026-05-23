import { defineConfig, devices } from "@playwright/test";

/**
 * Mashi visual regression suite.
 *
 * The setup project signs in once (via a Supabase service-role flow or an
 * intercept-based fallback — see tests/visual/auth.setup.ts and
 * tests/visual/README.md) and persists session cookies to
 * `tests/visual/.auth/user.json`. All visual specs reuse that storage.
 *
 * The visual smoke tests live in tests/visual/. Each spec calls
 * `toHaveScreenshot()` against a stable selector and Playwright compares
 * against committed baselines in `tests/visual/__screenshots__/`.
 *
 * Run locally:
 *   pnpm test:visual                # compare against committed baselines
 *   pnpm test:visual:update         # regenerate baselines after a deliberate
 *                                   # visual change (e.g. primitive promotion)
 */
export default defineConfig({
  testDir: "tests/visual",
  // Visual regression specs are expensive; run serially for stable
  // screenshots. Parallelism is fine for non-visual specs we may add
  // later, but the bottleneck here is the dev server.
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  // Snapshot baselines live next to the specs, under
  // tests/visual/__screenshots__/<spec>/<name>-<browser>-<platform>.png.
  expect: {
    toHaveScreenshot: {
      // 1% diff allowance. Below this is sub-pixel font-rendering jitter
      // and platform aa differences; above this is real layout drift.
      maxDiffPixelRatio: 0.01,
      // Disable animations during screenshot capture so motion doesn't
      // cause flaky diffs.
      animations: "disabled",
      caret: "hide",
    },
  },
  use: {
    baseURL: "http://127.0.0.1:3456",
    // Persist artifacts on failure for triage.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Lock device profile so font rendering and DPR are deterministic
    // across machines.
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
  },
  // Single chromium project — adding firefox/webkit doubles baselines
  // without catching meaningfully different layout bugs at this scale.
  projects: [
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        storageState: "tests/visual/.auth/user.json",
      },
      dependencies: ["setup"],
    },
  ],
  // The webServer block boots the local dev server before the tests
  // run. It reuses an existing server on port 3456 if one is already
  // up (so you can iterate locally without restarting on every spec
  // run).
  webServer: {
    command: "pnpm dev",
    port: 3456,
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
