# Visual regression tests

Playwright-driven screenshot smoke tests for every dashboard route. The
goal is to catch structural layout regressions (chrome invisibility,
z-stacking bugs, primitive promotion side-effects) before they ship.

## Run locally

```bash
# First time: install browser binaries
pnpm exec playwright install --with-deps chromium

# Compare against committed baselines
pnpm test:visual

# After a deliberate visual change (e.g. promoting a callsite to a new
# primitive), regenerate the baselines and commit them
pnpm test:visual:update
```

## Auth

The dashboard routes are gated by Supabase auth + the onboarding
middleware. Each spec reuses a `storageState` produced once by
`auth.setup.ts`. There are two paths the setup project can take:

### Path A — real Supabase auth (preferred)

Set these env vars before running:

| Var                            | Where                                    |
| ------------------------------ | ---------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`     | already in `.env.local`                  |
| `SUPABASE_SERVICE_ROLE_KEY`    | Supabase Dashboard → API → service_role  |
| `PLAYWRIGHT_TEST_USER_ID`      | `auth.users.id` of a dedicated test user |
| `PLAYWRIGHT_TEST_USER_EMAIL`   | matching email                           |

The setup project mints a magic-link via the GoTrue admin API, follows
it in a headless browser, lets the OAuth callback set Supabase session
cookies, and persists the resulting storage state.

### Path B — intercept fallback

If those env vars are absent, the setup drops a marker cookie and
proceeds without real auth. Pages that fetch user data server-side
will render their empty / unauth state. That's enough to validate
chrome / shell / primitive layout but not data-density bugs.

## Baselines

Committed under `tests/visual/__screenshots__/`. Each baseline filename
encodes the spec + browser + platform, e.g.
`dashboard-routes.spec.ts/cockpit-chromium-darwin.png`. Cross-platform
diffs are real — keep the suite running on one canonical OS in CI to
avoid alarm fatigue. We target Linux in CI; local macOS runs may show
font-rendering diffs that we ignore.

`.auth/user.json` is gitignored — never commit a real session token.

## Adding a new dashboard route

1. Add `{ path: "/new-route", name: "new-route" }` to the `ROUTES`
   array in `dashboard-routes.spec.ts`.
2. `pnpm test:visual:update` to capture the first baseline.
3. Commit the new `.png` under `tests/visual/__screenshots__/`.

## Catching the S2D column-header regression

The S2D column headers (`SectionHeader` primitive) sit over the
ambient album-art layer. The bug we're guarding against is regression
to `bg-primary/10` (or any other near-transparent color) that made the
headers invisible. The baseline for `/s2d` should always show the
backdrop-blurred header strip above each column. If a future change
makes them transparent, the screenshot diff will fire.

## When a baseline fails

1. Inspect the diff in the Playwright HTML report (`pnpm exec
   playwright show-report`).
2. Is the diff intentional?
   - Yes → `pnpm test:visual:update` and commit the new baseline.
   - No → fix the regression. Don't update the baseline.

## Wiring into CI

`pnpm verify` runs the suite. CI also runs `pnpm test:visual`
independently as a separate step so the diff artifact is uploaded for
PR review.
