# Layout smoke test

Manual checklist for layout regressions. Run before each release. Each
test exists because a prior session shipped the inverse — these are the
regressions to keep out, not theoretical concerns.

Pair this with `pnpm audit:layers` which catches the structural form
(hand-picked z values) but not the visual form (does the overlay
actually paint above content).

## Setup

- Local dev: `pnpm dev`, log in, sit at `/s2d`.
- Have at least 3 items in the S2D board so you can plan + run a sprint.
- Connect Spotify (Settings -> Connections) so the ambient bg is real.

## Test 1 — Sprint overlay vs sidebar + dropdown

Goal: the focus takeover covers main content; sidebar stays on top of
the takeover; the queue dropdown in the takeover header stays on top
of the slot grid.

1. From `/s2d`, click "Plan sprint" -> add a few items -> start sprint.
2. The fullscreen takeover should now be visible.
3. Verify the sidebar (left rail) is still solid black, fully visible,
   and clickable. Nav links should work — click `/inbox`, confirm the
   takeover stays mounted (route changed, sprint did not exit) and the
   sidebar is still on top.
4. Back on the sprint overlay, click the Spotify chevron in the header
   to expand the queue. The queue dropdown must paint on top of the
   slot cards below it. No clipping at the bar's bottom edge.

PASS: sidebar visible at all times, queue dropdown over slots.
FAIL example: sidebar disappears under takeover (sidebar z value got
overridden), or queue dropdown gets clipped by the chrome bar's
stacking context.

## Test 2 — Sprint complete recap renders once and stays

Goal: ending a sprint on `/sprint` shows the recap and keeps it visible.
The pre-doctrine bug: two copies of `<SprintComplete />` mounted
(one from /sprint, one from SprintGlobalMount), both POSTed the
session, both fired `exitSprint`, recap flashed for 1 frame and
disappeared.

1. Be on `/sprint` with an active sprint.
2. Mark every active slot Done (or Skip until all settled).
3. The recap screen ("Sprint complete") should appear and STAY.
4. The "Save & back to board" / "Save & plan another" buttons should
   be clickable. No console errors about duplicate state writes.

PASS: recap shows + persists. Single POST in Network tab.
FAIL example: recap flashes for under a second then jumps to /s2d or
shows the idle splash. Two POSTs to `/api/sprint/session` in Network.

## Test 3 — Queue dropdown over board cards

Goal: dropdowns from `z-chrome` bars correctly paint over `z-shell`
page content (cards, columns).

1. Sit on `/s2d`. Confirm the Spotify player in the top bar is visible
   and a track is playing (so there's a queue to expand).
2. Click the chevron-up on the player to expand the queue dropdown.
3. The dropdown should overlap the top row of board cards.
4. Click a card UNDER the dropdown. Click should hit the dropdown
   contents (or close it if outside dropdown), NOT the card behind.

PASS: dropdown clearly on top of cards, hit-testing reaches it first.
FAIL example: dropdown shows behind/inside a card column.

## Test 4 — Ambient background visible through translucent chrome

Goal: backdrop-filter on translucent surfaces (TopBar, SprintBar)
samples the ambient album art beneath them. If the ambient is in a
different stacking context, the blur picks up plain background instead
and the page looks dark regardless of art.

1. Sit on `/s2d` with Spotify connected + a track playing.
2. Look at the TopBar (the row with the player). You should see a
   subtle tint of the album art bleeding through the translucent bar.
3. Start a sprint. The takeover's translucent shell should also tint
   from the same ambient art (slightly more saturated since the shell
   is `bg-background/15` — less coverage).
4. Switch tracks; the tint follows the new album art on both surfaces.

PASS: translucent surfaces tint from the ambient.
FAIL example: TopBar / sprint overlay look pure dark, ambient only
shows behind page content.

## Test 5 — Modal over everything

1. From any route, press `Cmd+K` to open Spotlight.
2. The modal should cover sidebar, top bar, page content. Click outside
   to dismiss; click inside the search input; arrow-key through results.

PASS: modal fully on top.
FAIL example: sidebar pokes through (sidebar got bumped above modal,
which would defeat the layer order).

## Audit script

```bash
pnpm audit:layers
```

Exits 0 if no hand-picked z values are present. Run automatically as
part of `pnpm verify`.
