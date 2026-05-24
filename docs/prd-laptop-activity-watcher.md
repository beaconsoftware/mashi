# PRD — Laptop Activity Monitor

**Owner:** Sidd
**Status:** Draft v2, pre-engineering
**Date:** 2026-05-24
**Changelog:**
- v2.1 (2026-05-24): Schema notes — stage gate is `needs_review = false`, not `reviewed_at IS NOT NULL`. Real s2d_items.status values are `'backlog' | 'todo' | 'in_progress' | 'in_queue' | 'done'`. TTL uses Vercel cron (`/api/activity/maintenance`) because pg_cron isn't enabled on this Supabase project. GitHub Done detection is poll-based (piggybacks on existing /api/sync/all cron).
- v2 (2026-05-24): No auto-promotion ever. Adds Done detection. Adds 24h dismiss queue. Adds cockpit redesign. Opt-in only. Scope narrowed to internal users.
- v1: Initial draft.

## 1. Problem

Mashi already triages incoming work from email, Slack, Linear, calendar, and meeting transcripts. What it can't see is the *outgoing* signal — what you're actually working on right now. As a result:

- Items sit in `next` / `later` even after you start them. You manually drag them to `doing`.
- Items stay in `doing` long after they're complete. You forget to mark them Done.
- "What was I in the middle of?" requires a manual scan when you return from a meeting or a break.
- Sprint mode is the only path to focused work tracking; you opt in. Outside of sprint mode, Mashi is blind to your actual day.

This PRD covers a passive-presence capability: Mashi observes what you're working on across your laptop, **and whenever it has high confidence a task should change state, it sends you a notification with three explicit choices**. It never moves a task on its own.

## 2. Goals

- **G1.** When the user starts working on an existing S2D item (browser URL, app focus, file open, etc.), Mashi sends a "Move to In Progress?" notification with Yes / No / Dismiss within ~30 seconds.
- **G2.** When the user finishes an S2D item (Linear issue closed, PR merged, Gmail thread archived, file untouched for N hours after recent activity), Mashi sends a "Move to Done?" notification with the same three options.
- **G3.** Every notification includes *why* — the specific signal(s) that triggered the suggestion, so the user can quickly trust or reject it.
- **G4.** Only items **past the Review stage** in the S2D flow are eligible. Items still being triaged are off-limits.
- **G5.** If no matching open S2D item is found for whatever the user is doing, Mashi does **nothing** — no toast, no creation, no dummy match.
- **G6.** Coverage spans **(a)** the browser, **(b)** the Mac desktop (Cursor, Claude Desktop, Slack desktop, Linear desktop, Finder, terminal), and **(c)** existing cloud signals Mashi already pulls.
- **G7.** Opt-in only. No data is captured until the user explicitly enables the watcher from Settings.

## 3. Non-goals

- **NG1.** **No auto-promotion. Ever.** No state change without an explicit user click. This is non-negotiable per product direction.
- **NG2.** Suggesting new S2D items. The watcher only correlates against items the triage pipeline already created and reviewed.
- **NG3.** Acting on items still in triage/review. Stage gate: `reviewed_at IS NOT NULL`.
- **NG4.** Time tracking for billing. Not the product.
- **NG5.** Productivity scoring / surveillance ("you spent 4 hours on Twitter"). Not the product.
- **NG6.** Windows / Linux clients. Mac only.
- **NG7.** Public install flow / Chrome Web Store distribution. Internal Beacon users only; ships via direct download + side-load.
- **NG8.** Replacing sprint mode. Sprint mode is opt-in intentional focus; this is for everything *outside* sprint mode.

## 4. Users + use cases

### Primary user
Internal Beacon Mashi users only (currently ~5–10 people). Access already gated behind Vercel auth + Supabase RLS. No public distribution in v1.

### Use cases

1. **Start-of-task detection (→ In Progress).** User finishes a call, opens Cursor on a file from a Linear issue. Within 30s, Mashi sends a notification:
   > **Move *Fix S2D drag handle* to In Progress?**
   > Detected: Cursor open on `s2d-drag-handle.tsx` (matches Linear MAP-123 in the item description).
   > [Yes, move] · [No, keep as is] · [Dismiss · view later]

2. **End-of-task detection (→ Done).** User merges PR for *Fix login bug*. Mashi sends:
   > **Move *Fix login bug* to Done?**
   > Detected: GitHub PR #42 merged 2 min ago, linked to Linear MAP-118.
   > [Yes, move] · [No, keep as is] · [Dismiss · view later]

3. **Dismiss → 24h review queue.** User is mid-meeting and doesn't want to deal with a notification. Clicks Dismiss. The suggestion goes into a "Pending suggestions" queue inside cockpit. After 24h with no action, the suggestion is dropped silently.

4. **No match → silence.** User opens their personal email or a non-work browser tab. Mashi finds no matching S2D item. Nothing happens.

5. **Pick up where you left off (cockpit widget).** User opens Mashi cockpit after lunch. The redesigned cockpit shows their currently-active In Progress items at the top with light recency metadata ("Last active: Cursor, 18m ago").

6. **Pause for privacy.** User clicks the menubar icon → "Pause for 1 hour" / "Pause for the day". All three feeders go silent. Used during therapy, performance reviews, personal browsing.

## 5. Architecture

One pipeline. Three feeders. One backend. **Suggestion-only outputs — never auto-action.**

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
│                                                 • GitHub│
│                                                   PR    │
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
              + stage gate (reviewed_at NOT NULL)
              + Done-signal detector
                             │
                             ▼
              activity_suggestions table
              (each entry: pending | confirmed | rejected | dismissed | expired)
                             │
                             ▼
              ALWAYS surfaces as notification
                ├── cockpit toast (live)
                ├── menubar badge (helper)
                ├── browser-ext popup (if browser focused)
                └── cockpit "Pending suggestions" section
                          (24h queue)
                             │
                             ▼
              user clicks → S2D state transition
              (the ONLY path to a state change)
```

### Why one pipeline
Three separate ingestion stacks would mean three separate matchers, three separate suggestion UIs. Funneling everything into one `activity_events` row format means the matcher and notification UI are written once.

### Why suggestion-only
Per product direction: state changes must always be explicit. The matcher's job ends at producing a high-confidence suggestion. The UI's job is to surface it clearly and let the user decide. We never move tasks ourselves, no matter how confident the model is.

## 6. Data model

Two new tables, both additive, both RLS owner-only.

### `activity_events` — raw signal log

```sql
CREATE TABLE public.activity_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid(),
  source        TEXT NOT NULL,            -- 'mac_helper' | 'browser_ext' | 'cloud'
  surface       TEXT NOT NULL,            -- 'linear' | 'gmail' | 'slack' | 'cursor' | 'github' | 'finder' | 'terminal' | 'web'
  identifier    TEXT,                     -- canonical ID (Linear MAP-123, gmail thread, PR #, channel id)
  title         TEXT,                     -- window title or page title (trimmed to 200 chars)
  app           TEXT,                     -- frontmost macOS app or browser name
  url           TEXT,                     -- canonical URL if any
  signal_kind   TEXT,                     -- 'open' | 'focus' | 'close' | 'merge' | 'archive' | 'idle_end'
  started_at    TIMESTAMPTZ NOT NULL,
  ended_at      TIMESTAMPTZ,
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

-- TTL: pg_cron purges raw events older than 7d
SELECT cron.schedule(
  'activity_events_ttl',
  '0 * * * *',
  $$ DELETE FROM public.activity_events WHERE started_at < now() - interval '7 days'; $$
);
```

### `activity_suggestions` — the queue the user actually interacts with

```sql
CREATE TABLE public.activity_suggestions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid(),
  s2d_item_id     UUID NOT NULL REFERENCES public.s2d_items(id) ON DELETE CASCADE,
  proposed_state  TEXT NOT NULL,         -- 'in_progress' | 'done'
  status          TEXT NOT NULL DEFAULT 'pending',
                                          -- 'pending' | 'confirmed' | 'rejected' | 'dismissed' | 'expired'
  confidence      NUMERIC(4,3) NOT NULL,
  signal_kind     TEXT NOT NULL,         -- 'exact_id' | 'url_match' | 'title_embed' | 'cloud_lifecycle'
  context         JSONB NOT NULL,        -- why we matched: { event_ids, reason_human, snippets }
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at      TIMESTAMPTZ,
  dismiss_until   TIMESTAMPTZ            -- if dismissed, when does it leave the queue (created_at + 24h)
);

CREATE INDEX activity_suggestions_user_pending_idx
  ON public.activity_suggestions (user_id, created_at DESC)
  WHERE status IN ('pending', 'dismissed');

ALTER TABLE public.activity_suggestions ENABLE ROW LEVEL SECURITY;
CREATE POLICY activity_suggestions_owner ON public.activity_suggestions
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Mark dismissed suggestions as expired after their 24h window
SELECT cron.schedule(
  'activity_suggestions_expire',
  '*/15 * * * *',
  $$ UPDATE public.activity_suggestions
     SET status = 'expired'
     WHERE status = 'dismissed' AND dismiss_until < now(); $$
);
```

The `context` JSONB always includes a `reason_human` string the UI renders verbatim (e.g. *"Cursor open on `s2d-drag-handle.tsx` matches MAP-123 in description"*) and an `event_ids` array referencing `activity_events.id` so the user can drill into the raw signals if they want.

## 7. API surface

### `POST /api/activity/heartbeat`
Ingestion endpoint. Used by all three feeders. Auth via Bearer `mashi_api_token` with `activity:write` scope.

```ts
// Request
{
  source: 'mac_helper' | 'browser_ext' | 'cloud',
  client_id: string,
  events: Array<{
    surface: string,
    identifier?: string,
    title?: string,
    app?: string,
    url?: string,
    signal_kind: 'open' | 'focus' | 'close' | 'merge' | 'archive' | 'idle_end',
    started_at: string,
    ended_at?: string,
  }>
}

// Response
{
  ingested: number,
  new_suggestions: number  // count of activity_suggestions rows created this batch
}
```

Note: heartbeat does **not** return suggestions inline. Suggestions land via the cockpit live subscription + desktop/menubar notification (next section). This keeps the heartbeat path fast and the suggestion delivery path explicit.

### `GET /api/activity/suggestions`
For the cockpit "Pending suggestions" section. Returns pending + dismissed-but-still-in-24h-window items.

```ts
// Response
{
  pending: Array<Suggestion>,
  dismissed: Array<Suggestion>,    // dismissed within last 24h, still queryable
}

type Suggestion = {
  id: string,
  s2d_item: { id: string, title: string, current_state: string, ... },
  proposed_state: 'in_progress' | 'done',
  confidence: number,
  reason_human: string,
  signal_snippets: Array<{ source: string, surface: string, title?: string, when: string }>,
  created_at: string,
  dismiss_until?: string,
}
```

### `POST /api/activity/suggestions/:id/decide`
The only state-change path.

```ts
// Request
{ decision: 'confirm' | 'reject' | 'dismiss' }

// On confirm: writes status='confirmed' AND transitions the s2d_item to proposed_state
// On reject:  writes status='rejected'. Item stays put.
// On dismiss: writes status='dismissed', dismiss_until = now() + 24h. Item stays put.
//             Surfaced in cockpit "Pending suggestions" section for 24h.
```

### `POST /api/activity/pause` / `POST /api/activity/resume`
Global pause. The mac helper menubar + browser extension both read this state and stop emitting.

```ts
// Request
{ duration_minutes?: number }   // omit for indefinite

// Response
{ paused: boolean, resume_at?: string }
```

## 8. Matcher + Done detection

Same confidence tiers as v1, but the output is always a suggestion row in `activity_suggestions`, never a state change.

### Suggestion is created when ALL of:
1. Confidence ≥ 0.85 (high signal — exact ID match, URL match with stable canonical, or PR-merged lifecycle event)
2. There is an open S2D item whose `reviewed_at IS NOT NULL` matching the signal
3. The proposed state actually advances the item:
   - Current `next` / `later` + signal indicates active work → propose `in_progress`
   - Current `in_progress` + signal indicates completion → propose `done`
4. No pending or confirmed suggestion for the same `(item_id, proposed_state)` in the last 30 minutes (dedup)

If any condition fails: no suggestion. Specifically — **no matching item → no suggestion, no fallback, no creation of a placeholder.**

### Done-signal detector — what counts as "task complete"

| Signal | Surface | Confidence |
|---|---|---|
| Linear issue moves to `Done` / `Cancelled` state | cloud (Linear API) | 0.99 |
| GitHub PR merged, PR description links to S2D item | cloud (GitHub webhook OR polling) | 0.95 |
| Gmail thread archived AND last sent message is from the user | cloud (Gmail API) | 0.85 |
| Slack thread the user replied to has had no new messages in 24h after the user's reply | cloud (Slack API) | 0.70 (suggestion only if no other signal contradicts) |
| File matching the item title was edited then untouched for 4h+ | mac_helper | 0.65 |
| User-explicit signal: "/done" command in Mashi chat referencing the item | chat | 0.99 |

**GitHub** is a new feeder for Done detection. It's a cloud signal (webhook or poll) and doesn't require any laptop client.

### Reason string — what shows up in the notification

Always answer two questions:
1. **What did we see?** ("Linear issue MAP-123 moved to Done at 2:14 PM")
2. **Why does it map to this S2D item?** ("Item *Fix S2D drag handle* references MAP-123 in its description")

The notification renders both as bullet points so the user can trust-or-reject in one glance.

## 9. Notification UX — three options, always

### Cockpit toast (live, when Mashi is foregrounded)
Uses existing Sonner stack.

```
┌──────────────────────────────────────────────────────────┐
│ 🟡 Move *Fix S2D drag handle* to In Progress?            │
│                                                            │
│ • Cursor open on `s2d-drag-handle.tsx` for 4m              │
│ • Item description references MAP-123                      │
│                                                            │
│ [Yes, move]  [No, keep as is]  [Dismiss · view later]     │
└──────────────────────────────────────────────────────────┘
```

### Menubar notification (when Mashi web app is not focused)
Native macOS notification from the Tauri helper. Same three buttons via notification actions. Clicking the body opens the cockpit pending-suggestions section.

### Browser extension popup
If the browser is focused and Mashi isn't, the extension shows a small in-page bubble in the bottom-right with the same three actions. Auto-hides after 30s but the suggestion stays in the cockpit queue.

### Dismiss → 24h queue
Dismissed suggestions appear in a "Pending suggestions" section in the cockpit (see §10). After 24h with no action, they silently expire.

### Sprint-mode interaction
During sprint mode: events still record, but no live notifications fire. Suggestions accumulate in the queue and surface together at sprint-end recap.

## 10. Cockpit redesign

The cockpit becomes a focused 4-section layout. Other widgets we have today either move into one of these sections or are removed.

### Section 1 — Search
Top of the page. Single search input that queries across S2D items, messages, meetings, and notes. Reuses the existing spotlight/search infra; just promoted from a modal to a persistent UI surface.

### Section 2 — This week so far (with light gamification)
A summary strip:
- Items completed this week (count + delta vs last week)
- Items in progress
- A streak badge if 5+ items completed each weekday
- A small visual: each completed item adds a tile to a "your week" grid — Wordle-grid energy, glanceable
- One-line trend ("ahead of last week" / "matching pace" / "behind")

Gamification stays *light* — never judgmental, never red. Color = blue + green only. If a week is slow, the strip shrinks but doesn't shame.

### Section 3 — Active items
What's in `in_progress` right now, ordered by most recently active. Each row shows:
- Item title
- Last-active signal ("Cursor, 18m ago" / "Linear, 1h ago")
- Inline "Mark done" button (which triggers a confirm — no surprise state changes)

This is where you go when you sit back down at your laptop and need to remember what you were on.

### Section 4 — Inbox needs attention
Unread emails + Slack DMs + Slack mentions that the triage pipeline flagged as needing a human response and haven't been responded to. NOT every unread item — only ones triage decided are real.

Each row has a "Reply now" CTA that opens the source (Gmail thread, Slack channel) and an "Already handled" CTA that closes the loop (this is also a state change, also requires a click).

### Pending suggestions section
Lives just below Section 3 ("Active items") when non-empty; hidden otherwise. Shows dismissed-within-24h suggestions and any that arrived while the user wasn't looking. Same Yes / No / Dismiss controls.

### What's removed from cockpit
- Anything that doesn't fit one of these 4 sections gets demoted to a sub-route or removed.
- The current ambient "Now Move" tile gets folded into Section 3.

## 11. Phasing

| Phase | Scope | Engineer-days |
|---|---|---|
| **P1. Backend + cockpit redesign** | `activity_events` + `activity_suggestions` tables, `/api/activity/*` routes, matcher v1 (exact ID + URL match), suggestions delivered to a new live-subscription endpoint, cockpit redesigned to the 4-section layout. Fed by synthetic events for testing. | 4 |
| **P2. Cloud feeder + Done detection** | Tap the existing sync code to emit heartbeat events for Linear / Gmail / Slack lifecycle events. Add Linear-issue-state-change and GitHub-PR-merged detection. Validates the full notification UX with zero client install. | 1.5 |
| **P3. Browser extension** | MV3 manifest, content script, options page with paste-in `mashi_api_token`. Chrome + Arc + Brave. Per-domain ignore list. Internal side-load only (no Chrome Web Store in v1). | 2 |
| **P4. Mac menubar helper** | Tauri menubar app. Frontmost-app polling, browser-URL via AppleScript, idle detection, pause control, native notification actions for Yes/No/Dismiss. Codesigned + notarized (Beacon developer account). | 5 |
| **P5. Matcher v2** | Embedding similarity for title-only matches. Done-signal detector refinements. Confidence-threshold tuning from real telemetry. | 2 |
| **P6. Hardening** | Per-domain/app ignore UI, rate-limiting, structured logging, internal install docs (how to install the helper for new Beacon team members). | 2 |

Total **~16.5 engineer-days** for the full stack. P1 + P2 give useful behavior in week 1.

Cockpit redesign moves into P1 because the cockpit is where suggestions land — we can't ship the suggestion path without a place to show pending suggestions, completed items (Section 2 needs the data), and active items (Section 3). Section 4 (Inbox) is the lowest priority; if P1 is at risk, it can slip to P6.

## 12. Privacy + opt-in

The product is internal-only behind Vercel auth and Supabase RLS, so the "anyone on the internet might install this" concerns from v1 go away. What's left:

### Opt-in flow
1. New Settings → Activity Monitor page. Default state: **Off**.
2. Toggle to enable shows a one-screen explainer:
   - "We'll track which apps and URLs you have focused so we can suggest task state changes. We never auto-change anything."
   - "Raw signals stay in your Beacon Supabase. 7-day retention. You can pause or disable any time."
   - "You'll need to install the Mac helper and/or browser extension for full coverage; cloud signals work standalone."
3. On enable, generate an `activity:write`-scoped `mashi_api_token`. Show it once for paste into the helper / extension.

### Data hygiene
- 7-day TTL on `activity_events` (raw).
- `activity_suggestions` persists indefinitely so the user has audit history of what was confirmed/rejected.
- Window-title + URL text encrypted at rest via Supabase column encryption.
- No screenshots, no keylogging, no clipboard reads. Window title text and URLs only.
- Per-app + per-domain ignore lists, in the helper menubar AND the web settings page. Defaults to ignoring: 1Password, banking domains, anything matching `*therapy*`, `*medical*`, `*salary*`, `*personal*` (case-insensitive).
- Global pause (1h / 4h / today / indefinite) reachable from both the menubar and the web settings page.

### What we are NOT doing (internal-user simplifications)
- No Chrome Web Store submission. Side-load only.
- No open-sourcing the helper repo in v1 (internal-only audience).
- No formal SOC2/GDPR audit work — already covered by Beacon's existing posture.
- No team-level admin controls. Per-user only.

## 13. Open questions

1. **Where exactly does "Pending suggestions" live in cockpit?** Below Section 3 makes sense to me but worth visual-mocking.
2. **Tauri vs Swift for the helper?** Tauri = TS familiarity, can share matcher logic. Swift = smaller binary, more native feel. Lean Tauri unless someone has strong Swift conviction.
3. **What counts as "past Review stage" precisely?** Need to point at a column on `s2d_items` (probably `reviewed_at IS NOT NULL`, but confirm against the actual schema).
4. **GitHub integration scope.** Webhook-based or poll-based? Webhook is real-time + cleaner but needs a new connection setup flow. Poll-based piggybacks on existing cron.
5. **What about Linear desktop app?** Window title leaks the issue title cleanly ("Fix login bug — Issues — Linear") so the helper can match without needing browser/URL — but only if the helper has Accessibility permission. Make this an explicit upsell in the install flow.
6. **Confidence threshold ≥ 0.85 — too aggressive or too quiet?** Start there, tune from telemetry in week 4.

## 14. Risks

| Risk | Likelihood | Severity | Mitigation |
|---|---|---|---|
| Too many notifications → user disables the watcher | High | High | Confidence ≥ 0.85, 30-min dedup, sprint-mode silence, easy global pause |
| Wrong suggestions erode trust | Medium | High | Always show reason; explicit Yes/No/Dismiss means the user is never surprised; rejection signals tune future suggestions |
| Mac helper distribution friction (Accessibility permission install cliff) | Medium | Medium | Lead with browser extension + cloud signals; helper is a power-user upgrade for desktop-app coverage |
| Window titles leak more than expected | Medium | High | Default ignore list, per-app opt-out, documented loudly in the opt-in screen |
| Battery drain from continuous polling | Medium | Medium | 30s poll interval, idle detection, pause-on-battery option |
| User dismisses everything, queue grows endlessly | Low | Low | 24h hard expiry. Pending queue collapses if > 5 items shown ("+ 8 more"). |

## 15. Success metrics

- **Adoption:** % of internal users who opt in within 2 weeks of launch (target: 80% — small enough team that we can chase the holdouts directly)
- **Quality:** confirm-rate on surfaced suggestions (target: > 70%)
- **No false-action:** % of confirmed suggestions later undone (target: < 5%)
- **Cockpit retention:** % of daily cockpit visits that lead to at least one explicit action (any of the 4 sections) (target: > 80%)
- **Privacy incidents:** zero

## 16. Out of scope, possibly future

- Public install flow / Chrome Web Store
- Open-sourced helper repo
- Windows + Linux helpers
- iOS helper
- Calendar-event auto-correlation ("you're in the *MAP weekly sync* — surface items linked to MAP")
- Fireflies-live correlation ("you just said 'Fix the login bug' on this call — bump that item to the top of the queue")
- Replay timeline ("show me what I worked on yesterday")
- Team-level admin / rollup view
