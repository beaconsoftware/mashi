# Mashi Activity Watcher — Browser Extension

An MV3 web extension that sends tab-focus heartbeats to your Mashi
instance so it can suggest task state changes. Internal side-load only —
not published to any store.

Supported browsers: **Chromium-based** (Chrome, Brave, Arc, Edge) and
**Firefox 121+** (which accepts MV3 service-worker manifests as event pages).

## What it captures

- URL of the active tab
- Title of the active tab
- Timestamp of focus

## What it never captures

- Page content, DOM, or rendered HTML
- Form fields, cookies, keystrokes
- Screenshots, images, or downloads

## Where data goes

Only to the Mashi instance you configure (default
`https://mashi-two.vercel.app`). Nowhere else. The extension makes
exactly one outbound request type: `POST /api/activity/heartbeat` (plus
`/pause` and `/resume` when you click those buttons).

The token is held in `chrome.storage.local`, which is per-profile and
not synced.

## Install (Chrome / Brave / Arc / Edge)

1. Build the extension:

   ```bash
   cd apps/browser-ext
   npm install
   npm run build
   ```

   (We use `npm` here rather than `pnpm` because the directory is
   self-contained and not part of the root pnpm workspace.)

2. Open `chrome://extensions` (or `brave://extensions`, etc).
3. Enable **Developer mode** (top right).
4. Click **Load unpacked**.
5. Select the `apps/browser-ext/` directory (NOT `dist/` — Chrome reads
   `manifest.json` from this root).
6. The Mashi icon should appear in your toolbar.
7. Right-click the icon → **Options** (or click the icon → "Options" link).
8. Paste your `mashi_api_token` from `https://<your-mashi>/settings/activity`.
   The token needs the `activity:write` scope.
9. Click **Save**, then **Test connection**. You should see "Connection
   OK".

The extension is now active. Switching tabs will send a heartbeat after
5 seconds of dwell on each new tab.

## Install (Firefox 121+)

Firefox accepts the same manifest as Chromium MV3, but the install path
goes through `about:debugging` rather than `about:addons` (the extension
isn't signed by AMO).

1. Build the extension (same as Chromium — `npm install && npm run build`).
2. Open `about:debugging` in Firefox.
3. Click **This Firefox** in the left sidebar.
4. Click **Load Temporary Add-on…**
5. Navigate to `apps/browser-ext/` and select **`manifest.json`**.
6. The Mashi icon appears in the toolbar (or under the menu `>>` overflow).
7. Right-click the icon → **Manage Extension** → **Preferences** to open
   Options. Same flow from there: paste token, save, test.

**Caveat:** "Load Temporary Add-on" extensions are removed when Firefox
restarts. You'll need to re-load it on each Firefox launch until we
ship a signed XPI. For day-to-day use this is fine — Firefox prompts
once per session.

Firefox versions older than 121 don't accept MV3 ``service_worker``
manifests. The ``browser_specific_settings.gecko.strict_min_version``
field in ``manifest.json`` enforces this; older Firefox will refuse to
load. Upgrade your Firefox if you hit that.

## Using it

- **Status:** click the extension icon. You'll see Live / Paused /
  No token / Token invalid.
- **Pause:** click the icon → "Pause 1h" / "Pause 4h" / "Pause today".
  Pauses are server-side, so they apply to all your Mashi feeders (Mac
  helper, cloud sync) — not just the browser.
- **Resume:** same popup, "Resume now" button.
- **Uninstall:** `chrome://extensions` → Remove.

## Default ignore list

The extension never heartbeats for these hosts (suffix match):

- `chase.com`, `bankofamerica.com`, `wellsfargo.com`, `capitalone.com`,
  `citi.com`, `usbank.com`
- `1password.com`
- `*.bank`, `mybank.*`
- Therapy-related: `betterhelp.com`, `talkspace.com`, and any host
  containing `therapy`

Add your own ignore domains in Options.

## Architecture notes

- **MV3 service worker** (`src/background.ts`): listens for
  `chrome.tabs.onActivated`, `onUpdated`, `chrome.windows.onFocusChanged`.
  Debounces per-tab at 5s so URL-bar typing doesn't generate dozens of
  events. Batches up to 10 heartbeats per request.
- **Service worker termination:** Chrome MV3 service workers can be
  killed at any time. We use `chrome.alarms` (not `setTimeout`) for
  debounce/flush timing so state persists across restarts.
- **Backoff:** 429 with `Retry-After` is honored; 401 sets
  `tokenInvalid` and fires a `chrome.notifications` toast.
- **No content script** in v1. Everything works from background using
  the `chrome.tabs` API surface. We never inject anything into pages.

## Build commands

```bash
npm run build       # one-shot TypeScript compile to dist/
npm run watch       # rebuild on save during development
npm run typecheck   # type-check without emitting
npm run clean       # remove dist/
```

## TODO

- **Icons.** `icons/icon-16.png`, `icons/icon-48.png`, `icons/icon-128.png`
  are referenced in `manifest.json` but not yet shipped. Chrome will
  fall back to its default puzzle-piece icon until these are added.
- **Content script** for finer signals (page-visibility changes,
  hashchange-driven SPA routes). Deferred — `chrome.tabs.onUpdated`
  catches most of what we need for v1.
- **Chrome Web Store distribution.** PRD scope is side-load only.
