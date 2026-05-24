# Mashi Helper — macOS menubar app

Polls the frontmost app + active browser tab URL every 30 seconds and
emits heartbeats to your Mashi instance. Heartbeats become S2D
suggestions via the matcher in `src/lib/activity/`.

Distribution is internal-only — source ships in this repo and each user
builds locally. Codesigning + notarization is a follow-up once we have
the Apple Developer account configured.

## What the helper sees (and doesn't)

**Captures**: frontmost app name, window title (≤ 200 chars), browser
URL (Safari / Chrome / Brave / Arc / Edge), system idle time. Posts
those to `POST /api/activity/heartbeat` every 30s.

**Never captures**: keystrokes, screenshots, clipboard, file contents,
input field values, anything outside the frontmost window's title bar.
The Rust source is small enough to audit end-to-end —
`src-tauri/src/poll.rs` is the entire "what we read from the OS" code
path.

Sensitive surfaces (banking, 1Password, therapy-related domains) are
hardcoded into the ignore list at `src-tauri/src/ignore.rs` and stripped
before any network call. Add your own apps + domains in Settings.

## Prerequisites (one-time)

1. macOS 12 (Monterey) or newer
2. Xcode Command Line Tools:
   ```bash
   xcode-select --install
   ```
3. Rust toolchain:
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   source "$HOME/.cargo/env"
   ```
4. Node 20+ and pnpm (already required by the parent repo)

## Build

From the repo root:

```bash
cd apps/mac-helper
pnpm install
pnpm tauri build
```

The first build is slow (~5-10 min) because Cargo compiles every
transitive dep. Subsequent builds are incremental.

Output:

```
apps/mac-helper/src-tauri/target/release/bundle/macos/Mashi Helper.app
apps/mac-helper/src-tauri/target/release/bundle/dmg/Mashi Helper_0.1.0_aarch64.dmg
```

## Install

1. Drag `Mashi Helper.app` to `/Applications`.
2. Since this build isn't codesigned yet, the first launch will hit
   Gatekeeper:
   - **Right-click → Open** (not double-click)
   - macOS prompts "macOS cannot verify the developer…". Click **Open**.
   - Subsequent launches work normally.
3. The menubar icon (a small "M") appears in your menubar.
4. The settings window opens automatically on first run. Paste your
   personal access token from
   `https://mashi-two.vercel.app/settings/activity` and click **Save**.
5. Click **Test connection** to verify; you should see
   `OK — ingested 1, new suggestions 0.`

## Permissions

The helper requests two macOS permissions on demand:

### Accessibility (required)

System Settings → Privacy & Security → Accessibility → enable
**Mashi Helper**. Without this, window titles come back blank and the
matcher loses one of its main signals.

The settings window shows a banner with a one-click button to jump
straight to this pane.

### Automation (recommended — per browser)

Required to read the active tab URL via AppleScript. macOS prompts the
first time the helper sends an AppleScript event to each browser
(Safari, Chrome, Brave, Arc, Edge). Click **OK**.

If you said No by accident: System Settings → Privacy & Security →
Automation → expand **Mashi Helper** → re-enable each browser.

You can also click "Open Automation settings" in the helper's settings
window.

## Auto-launch on login

Enabled by default via `tauri-plugin-autostart` so the helper rejoins the
menubar after a reboot. Disable from the settings window or from System
Settings → General → Login Items.

## Architecture

```
src-tauri/src/
├── main.rs         # Thin entrypoint
├── lib.rs          # Tauri setup, tray menu, poll-loop spawn, IPC commands
├── poll.rs         # AppleScript / ioreg shellouts. The "what we read" file.
├── heartbeat.rs    # POST /api/activity/heartbeat
├── pause.rs        # POST /api/activity/pause + /resume
├── ignore.rs       # Local ignore-list logic (apps + domains)
└── keychain.rs     # macOS Keychain wrapper for the token

src/
├── index.html      # Stub — redirects to settings.html
├── settings.html   # The only real UI
└── settings.js     # Talks to Rust via window.__TAURI__.core.invoke
```

The poll loop lives in a single tokio task spawned from `lib.rs`. It
runs every 30 seconds, gates on `paused_until` and idle time, calls
`poll::poll_once`, and forwards a snapshot to `heartbeat::HeartbeatClient`.

The token lives in the macOS Keychain
(`service = app.mashi.helper, account = mashi_api_token`). Non-secret
settings (URL, ignore lists, `paused_until`, `client_id`) live in
`tauri-plugin-store`'s JSON file at
`~/Library/Application Support/app.mashi.helper/settings.json`.

## Verifying it's working

After a Save + Test you should see heartbeats arriving in Supabase:

```sql
select created_at, surface, app, title, url
from activity_events
where user_id = '<your-user-id>'
  and source = 'mac_helper'
order by created_at desc
limit 20;
```

Switching between Cursor, Slack, Linear in the browser, etc. should
produce one row every 30 seconds. After 5 minutes of idle (no mouse or
keyboard), polling stops.

## Deferred

The following are intentionally out of scope for this PR:

- **Codesigning + notarization.** Requires an Apple Developer Program
  account. Once we have one, follow Tauri's macOS signing guide and
  populate `signingIdentity` in `src-tauri/tauri.conf.json`. The user
  experience will then skip the Gatekeeper "right-click → Open" dance.
- **Real icons.** `src-tauri/icons/` ships with just a README. Drop in a
  1024×1024 master and run `pnpm tauri icon` to generate the full set.
  The build will fail until icons exist; do this once before the first
  internal release.
- **Universal binary.** Default build targets the host arch (arm64 on
  Apple silicon). Cross-compiling to a universal binary is a few extra
  lines in `tauri.conf.json` — defer until we ship to colleagues on
  Intel machines.
- **Native Yes/No/Dismiss notification actions.** PRD §9 calls for
  three-button macOS notifications for live suggestions. Notification
  actions need a separate UNNotificationCategory registered via the
  Notification Service Extension API. For now we only emit heartbeats;
  the cockpit handles suggestion review. Track in a follow-up.
- **Sprint-mode silence.** The helper still emits during sprint mode
  today. Suggestions just don't surface as notifications (the matcher
  queues them). Future work: read sprint state via a polled endpoint
  and stop emitting entirely while sprinting, matching the browser
  extension behavior.
