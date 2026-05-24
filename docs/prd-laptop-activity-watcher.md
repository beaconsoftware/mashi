# PRD — Laptop Activity Watcher

**Owner:** Sidd
**Status:** Draft, pre-engineering
**Date:** 2026-05-24

## 1. Problem

Mashi already triages incoming work from email, Slack, Linear, calendar, and meeting transcripts. What it can't see is the *outgoing* signal — what you're actually working on right now. As a result:

- Items sit in `next` / `later` even after you start them. You manually drag them to `doing`.
- "What was I in the middle of?" requires a manual scan when you return from a meeting or a break.
- Sprint mode is the only path to focused work tracking; you opt in. Outside of sprint mode, Mashi is blind to your actual day.

This PRD covers a "passive presence" capability: Mashi observes what you're working on across your laptop, surfaces a soft suggestion to move the matching S2D item to `doing`, and over time learns enough to auto-promote with confidence.

## 2. Goals

- **G1.** When the user opens an existing work surface (Linear issue, Gmail thread, Slack channel, design file, code repo) that matches an open S2D item, Mashi proposes promoting that item to `doing` within ~30 seconds.
- **G2.** After two confirmed promotions from the same source, future opens auto-promote silently — no toast, no click.
- **G3.** Coverage spans **(a)** the browser, **(b)** the Mac desktop (Cursor, Claude Desktop, Slack desktop, Linear desktop, Finder, terminal), and **(c)** existing cloud signals Mashi already pulls (Linear viewed, Gmail thread open in webmail, Slack channel with fresh activity, Fireflies live meeting).
- **G4.** Zero raw window-title or URL content ever leaves the user's Mashi-owned Supabase instance. Privacy posture is install-visible.
- **G5.** Public-grade install flow: any Mashi user can opt in from Settings → Connections without engineering help. Native helper is signed + notarized for macOS.

## 3. Non-goals

- **NG1.** Time tracking for billing / payroll reasons. We track for *next-action inference*, not invoicing.
- **NG2.** Productivity scoring or "you spent 4 hours on Twitter today" judgment. Not the product.
- **NG3.** Windows / Linux clients in v1. Beacon is Mac-first.
- **NG4.** Replacing sprint mode. Sprint mode stays for intentional deep work; this is for everything *outside* sprint mode.
- **NG5.** Suggesting new S2D items. The watcher only correlates against items the triage pipeline already created.

## 4. Users + use cases

### Primary user
Existing Mashi users (currently ~5–10 internal, ramping public). Knowledge workers whose day spans browser tabs + 2–3 native apps + terminal.

### Use cases
1. **Return-from-meeting.** User finishes a call, opens Cursor on a file from a Linear issue. Within 30s, Mashi pings: "Working on *Fix S2D drag handle*? Move to In Progress?" One click → item moves. No more drift.
2. **Tab-switch back to work.** User has been triaging email. Switches to a Linear issue tab. Mashi sees the URL, matches the open `next` item, suggests promotion.
3. **Already-confident promotion.** Second time today the user opens a Linear issue that maps to an item, Mashi promotes silently. A small toast announces it ("Moved *Fix login bug* to In Progress") with an Undo.
4. **Pick up where you left off.** User opens Mashi cockpit after lunch. A new "Pick up where you left off" widget shows the 1–3 items they were most recently active on, ranked by recency × confidence.
5. **Pause for privacy.** User clicks the menubar icon → "Pause for 1 hour." All three feeders go silent until the timer expires or they click resume. Used during therapy, performance reviews, salary negotiations, etc.

## 5. Architecture

One pipeline. Three feeders. One backend.

```
┌─────────────────────── feeders ────────────────────────┐
│                                                          │
│ Mac helper (Tauri)      Browser ext (MV3)       Cloud   │
│ ─────────────────       ──────────────────      ──────  │
│ • frontmost app         • active tab URL        • Linear│
│ • window title          • page title              issue │
│ • browser URL via AS    • focus/blur            • Gmail │
│ • terminal cwd/cmd      • time-on-tab             thread│
│ • idle detection                                 • Slack│
│                                                  channel│
└────────────────────────────┬─────────────────────────────┘
                             │
                             ▼
            POST /api/activity/heartbeat
            Bearer mashi_api_token
                             │
                             ▼
              activity_events table
              (append-only, TTL 7d, RLS owner-only)
                             │
                             ▼
              matcher (URL+ID exact → embedding fuzz)
                             │
                             ▼
              suggestion stream
                ├── cockpit toast
                ├── sprint widget overlay
                └── auto-promote (after 2 confirms)
```

### Why one pipeline
Three separate ingestion stacks would mean three separate matchers, three separate suggestion UIs, three separate privacy stories. Funneling all feeders into one `activity_events` row format means the matcher and UI are written once. Adding a fourth feeder later (Windows, iOS, vim plugin) is just a new sender.

### Why client-side feeders (vs server-side polling)
Server can't see your laptop. Period. The only signals we can capture from cloud APIs are what providers expose to Mashi's existing connections (Gmail thread last opened, etc.) — that gets us ~30% coverage. The other 70% requires something running on the laptop.

## 6. Data model

New table: `activity_events`. Additive migration.

```sql
CREATE TABLE public.activity_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid(),
  source        TEXT NOT NULL,            -- 'mac_helper' | 'browser_ext' | 'cloud'
  surface       TEXT NOT NULL,            -- 'linear' | 'gmail' | 'slack' | 'cursor' | 'finder' | 'terminal' | 'web' | ...
  identifier    TEXT,                     -- e.g. 'MAP-123', gmail thread id, slack channel id, URL
  title         TEXT,                     -- window title or page title (trimmed to 200 chars)
  app           TEXT,                     -- frontmost macOS app (helper) or browser name (ext) or null (cloud)
  url           TEXT,                     -- canonical URL if any (ext, helper-via-AS, or cloud)
  started_at    TIMESTAMPTZ NOT NULL,
  ended_at      TIMESTAMPTZ,              -- nullable: still active
  client_id     UUID NOT NULL,            -- per-install token to dedup across machines
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX activity_events_user_started_idx
  ON public.activity_events (user_id, started_at DESC);

CREATE INDEX activity_events_user_identifier_idx
  ON public.activity_events (user_id, identifier)
  WHERE identifier IS NOT NULL;

ALTER TABLE public.activity_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY activity_events_owner ON public.activity_events
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- TTL: a pg_cron-scheduled job deletes rows older than 7d. Cheap.
SELECT cron.schedule(
  'activity_events_ttl',
  '0 * * * *',
  $$ DELETE FROM public.activity_events WHERE started_at < now() - interval '7 days'; $$
);
```

Suggestion outcomes live separately so they survive the 7-day raw-event TTL:

```sql
CREATE TABLE public.activity_promotions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid(),
  s2d_item_id   UUID NOT NULL REFERENCES public.s2d_items(id) ON DELETE CASCADE,
  signal_source TEXT NOT NULL,            -- matches activity_events.source
  signal_kind   TEXT NOT NULL,            -- 'exact_id' | 'url_match' | 'title_embed' | 'cloud_open'
  decision      TEXT NOT NULL,            -- 'auto' | 'confirmed' | 'dismissed' | 'undone'
  confidence    NUMERIC(4,3) NOT NULL,    -- 0.000 - 1.000
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

This is what the "two confirms → auto-promote" rule reads from.

## 7. API surface

### `POST /api/activity/heartbeat`
Single ingestion endpoint. Used by all three feeders.

```ts
// Request
{
  source: 'mac_helper' | 'browser_ext' | 'cloud',
  client_id: string,                    // UUID, stable per install
  events: Array<{
    surface: string,
    identifier?: string,                // canonical ID (Linear MAP-123, gmail msg id, etc)
    title?: string,
    app?: string,
    url?: string,
    started_at: string,                 // ISO-8601
    ended_at?: string,                  // ISO-8601, optional (open intervals re-update on next heartbeat)
  }>
}

// Auth
Authorization: Bearer <mashi_api_token>

// Response
{
  ingested: number,
  suggestions: Array<{
    s2d_item_id: string,
    item_title: string,
    confidence: number,
    signal_kind: string,
    action: 'suggest' | 'auto_promote',
    reason: string                      // "Detected Linear issue MAP-123 in active tab"
  }>
}
```

Rate-limit: 60 events / min per token (heartbeats batch up).

### `GET /api/activity/recent`
For the cockpit "Pick up where you left off" widget.

```ts
// Response
{
  items: Array<{
    s2d_item_id: string,
    title: string,
    last_active_at: string,
    signal_summary: string             // "Open in Cursor for 45m"
  }>
}
```

### `POST /api/activity/pause` and `POST /api/activity/resume`
Global kill switch. The mac helper's menubar reads this state too, so clicking pause in the web app silences the helper.

## 8. Matcher logic

Run on every batch of incoming events. Order of confidence (highest → lowest):

1. **Exact ID match (confidence 0.95+)**
   - URL contains `linear.app/.../issue/MAP-123` and an open S2D item has `linear_issue_id = MAP-123` → match.
   - URL is `mail.google.com/.../#inbox/<thread_id>` and an item has `gmail_thread_id = <thread_id>` → match.
   - URL is `app.slack.com/client/<workspace>/<channel>` and an item references that channel → match (lower confidence, channels host multiple items).

2. **Title + app signal (confidence 0.7–0.9)**
   - Active app is Cursor, window title is `index.tsx — mashi-feature-foo`, an open item is "Build feature foo" → embedding similarity > 0.85 → match.
   - Active app is Linear desktop, window title is "Fix login bug — Issues — Linear" → match by exact title against open items.

3. **Embedding similarity only (confidence 0.5–0.7)**
   - No app/URL signal, just window title vs item title. Surface as suggestion only, never auto-promote.

4. **Cloud-derived (confidence 0.4–0.8)**
   - Linear API reports issue MAP-123 viewed at T. Same identifier match as above but lower confidence because "viewed" ≠ "working on".

### Auto-promote rule
Auto-promote when **all** of:
- Confidence ≥ 0.85
- This is the user's 3rd-or-later promotion via the same `(signal_kind, item_identifier-or-app)` combo (queried from `activity_promotions`)
- Item is currently in `next` or `later`
- No promotion has been undone for this item in the past 24h

Otherwise: emit a soft suggestion (toast).

### Anti-spam
Dedup suggestions: same (item_id, signal_source) within 10 minutes → suppress repeats.

## 9. Suggestion UX

### Soft suggestion (default)
Cockpit toast (uses existing Sonner stack from `src/components/ui/sonner.tsx`):
> 📋 **Working on *Fix S2D drag handle*?**
> Move to In Progress? · [Yes] · [Not now] · [Never for this]

Auto-dismisses after 20s. "Not now" suppresses the same item for 30 min. "Never for this" writes a permanent ignore tied to the signal source.

### Auto-promote
Toast informs after the fact:
> ✅ **Moved *Fix login bug* to In Progress** · Undo

Undo within 60s reverses + records to `activity_promotions.decision = 'undone'`, which feeds back into the auto-promote rule (one undo halts auto-promotion from that signal for 7 days).

### Pick up where you left off (cockpit widget)
Top of `/cockpit` for the first 30 minutes after opening Mashi each session, then collapses. Shows up to 3 items.

### Sprint mode interaction
If the user starts sprint mode mid-day, the watcher *stops emitting suggestions* (sprint mode already says "this is what I'm doing"). It still records events to drive the post-sprint recap ("During this sprint, you also spent 12 minutes in Slack on the *coordinator-coverage* thread — want to log a follow-up?").

## 10. Phasing

| Phase | Scope | Ship target | Engineer-days |
|---|---|---|---|
| **P1. Backend skeleton** | Tables, `/api/activity/heartbeat`, `/api/activity/recent`, matcher v1 (URL+ID only), cockpit widget. Fed by synthetic events for testing. | Week 1 | 2 |
| **P2. Cloud feeder** | Hook the existing sync code to emit heartbeats when Linear issue / Gmail thread / Slack channel sees activity. Validates the whole suggestion UX before any client install. | Week 1 | 0.5 |
| **P3. Browser extension** | MV3 manifest, content script, options page with paste-in `mashi_api_token`. Chrome + Arc + Brave. Per-domain ignore list. | Week 2 | 2 |
| **P4. Mac helper** | Tauri menubar app. Frontmost-app polling, browser-URL via AppleScript, idle detection, pause control. Codesigned + notarized. Settings UI for ignore-app list. | Week 3–4 | 5 |
| **P5. Matcher v2** | Embedding similarity for title-only matches. Auto-promote rule. `activity_promotions` writes. | Week 4 | 2 |
| **P6. Hardening** | Per-domain/app ignore UI, rate-limiting, structured logging, public install docs, marketing page. | Week 5 | 3 |

Total ~3 engineer-weeks for the full stack. Useful behavior after P2 (week 1).

## 11. Privacy posture

This is the most-likely-to-kill-adoption part. Get this right or nobody installs the helper.

### Stated up front, in the install dialog
1. **Raw events stay in your own Mashi/Supabase.** Mashi never proxies them anywhere — not to Anthropic, not to OpenAI, not to a third party. Triage is the only LLM call, and it only sees the matched-and-confirmed S2D item, not the underlying window title.
2. **7-day TTL on raw events.** `activity_events` is auto-purged. Only `activity_promotions` (the decisions you confirmed) persists.
3. **Per-app / per-domain ignore lists**, settable in the helper menubar AND in Settings → Activity Watcher. Defaults to ignore: 1Password, Banking, Therapist*, Salary*, Personal*, Medical*, anything with "private" in the title.
4. **Global pause** from the menubar (1h / 4h / until tomorrow / indefinite). Pause syncs across web app and helper.
5. **Open-source the helper.** The Tauri app's repo is public. People can audit what's being captured.
6. **No screenshots, no keylogging, no clipboard.** Window title text only — same level of leakage as `top` or Activity Monitor.

### Permissions ask, sequenced
- Install the helper (no perms yet) → menubar appears, shows "Setup needed"
- Click setup → request **Accessibility** permission with explanation ("needed to read window titles of other apps")
- Optional: request **Automation** permission scoped to browsers ("needed to read your current tab URL — skip if you only want app-level signals")
- No microphone, no camera, no screen recording, no notifications-read permission.

### Compliance considerations
- Activity events contain potentially sensitive text. Encrypt at rest via Supabase's column-level encryption for `activity_events.title` and `activity_events.url`.
- GDPR / CCPA: "delete my data" already wipes via `auth.users ON DELETE CASCADE`. Document this.

## 12. Open questions

1. **Tauri vs Swift for the helper?** Tauri = TS familiarity, easier to maintain, can share matcher logic with the web client. Swift = smaller binary, more "native feel", harder to ship and codesign. Lean Tauri unless someone has strong Swift conviction.
2. **Browser extension distribution?** Chrome Web Store has a review process. We can side-load during dogfood, but public users need the store. ~1 week review time first time.
3. **What's the threshold for "two confirms → auto-promote"?** Two is a starting guess. Might need to be three. Will tune from telemetry.
4. **Should we expose the activity stream to AI chat?** ("What was I working on between 2pm and 4pm yesterday?") High value, but raises questions about how long we retain `activity_promotions`. Defer to v1.1.
5. **What happens during sprint mode + a fast tab-switch to something unrelated?** Probably nothing — sprint mode silences suggestions. But should the stream still record events for post-sprint recap? Yes — record always, suggest never during sprint.
6. **How does this interact with `mashi_api_tokens`?** New scope: `activity:write`. Token issuance flow needs UI changes to let the user generate a feeder-specific token with that scope only.

## 13. Risks

| Risk | Likelihood | Severity | Mitigation |
|---|---|---|---|
| Wrong auto-promotions erode trust | High | High | Conservative thresholds, undo prominence, ignore list, halt-on-undo |
| Mac helper distribution friction (Accessibility permission install cliff) | High | Medium | Lead with browser extension; helper is a power-user upgrade, not the entry point |
| Window titles leak more than expected (e.g. notes apps showing draft text) | Medium | High | Conservative default ignore list, per-app opt-out, document loudly |
| Battery drain from continuous polling | Medium | Medium | 30s poll interval, idle detection, pause-on-battery option |
| Browser extension breaks every Chrome major-version update | Medium | Low | MV3 is reasonably stable; budget 1 dev-day/quarter for maintenance |
| User installs helper, forgets it's running, sees random Mashi promotions and thinks the app is haunted | Medium | Medium | Onboarding tutorial. First promotion shows a "How did Mashi know?" link. |

## 14. Success metrics (post-launch)

- **Adoption:** % of Mashi users who install at least the browser extension within 2 weeks (target: 40%)
- **Quality:** ratio of confirmed-to-dismissed soft suggestions (target: > 60% confirm)
- **Auto-promote accuracy:** % of auto-promotions that *aren't* undone (target: > 90%)
- **Sprint-mode reduction:** users who report relying less on sprint mode for "this is what I'm doing" tracking (qualitative survey at 30 days)
- **Privacy incidents:** zero

## 15. Out of scope, possibly future

- Linux + Windows helpers
- iOS helper (focus-mode integration; reads which app is foregrounded)
- Calendar-event auto-correlation ("you're in the *MAP weekly sync* meeting → this item is the relevant followup")
- Voice / Fireflies-live-meeting correlation ("you just said 'Fix the login bug' on this call → suggest that item")
- Replay timeline ("show me everything I worked on yesterday")
- Team-level activity rollup (manager view) — almost certainly never, but flagging as a request that will probably come up
