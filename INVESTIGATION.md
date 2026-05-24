# Investigation: S2D board status-transition bugs

Diagnose-only. No code or DB changes in this PR; the proposed diffs are
illustrative.

## 1. Executive summary

Two surface bugs, two distinct root causes, and a common shape underneath.

- **Symptom A** ("Review queue cleared" fires with 63 items still in
  Review) is a **client-state leak** in `review-deck.tsx`. The deck's
  `cursor` `useState` is never reset on close — only via a
  `useEffect([open])` that runs *after* the first render of a reopened
  deck. If the previous session ended with `cursor >= validIndices.length`
  (e.g., the user swiped to the end and clicked "Back to board"), the
  first paint of the next opening renders `<DoneScreen count=63 />`
  before the effect's `setCursor(0)` flushes a corrective second render.

- **Symptom B** (Focus items appearing in `in_progress` unsolicited) has
  two converging server-side paths, both currently legal and ungated:
  1. `runTriageOnUnit` → `applyOperation("update")` accepts
     `patch.status = "in_progress"` from the LLM with no validation,
     no recent-touch guard, and no `needs_review` interlock. The triage
     prompt does not forbid this; Linear-sourced units in particular
     present `status: "Started"` to the agent on every sync, encouraging
     a Mashi-side mirror.
  2. `sprint-active-mode.tsx` and `sprint-active-mode-multi.tsx` flip
     `status: "in_progress"` whenever an item enters an active sprint
     slot — and nothing reverts it when the sprint ends or is abandoned.
     The user perceives "I was focusing inside a sprint" and "the board
     thinks this is in progress" as two separate things.

- **Shared shape:** in both, **status is mutated without UX awareness**.
  Symptom A: a status-bearing view (the deck) keeps a stale cursor
  across snapshots so the first render disagrees with the data.
  Symptom B: server jobs and sibling components write `status` against
  rows the user owns conceptually but never asked to move. There's no
  single bug, but there is a single discipline missing — the orchestrator
  has a `.lt("updated_at", recentTouchIso)` 24h grace window on
  `close` ops only, not on `update` ops. That asymmetry is the load
  bearing miss.

## 2. Symptom A — root cause

### The code path

The deck is rendered unconditionally inside `ReviewColumn`:

```tsx
// src/components/s2d/review-column.tsx:123
<ReviewDeck items={items} open={deckOpen} onClose={() => setDeckOpen(false)} />
```

That means `ReviewDeck` **stays mounted** for the lifetime of the column.
Its `useState` and `useRef` values persist across open/close cycles.

Snapshot + cursor logic, condensed:

```tsx
// src/components/s2d/review-deck.tsx:82-129
const [cursor, setCursor] = useState(0);

const deckRef = useRef<S2DItem[]>([]);
const lastOpenRef = useRef(false);

// Snapshot happens DURING render the first time open flips true with items > 0.
if (open && !lastOpenRef.current && items.length > 0) {
  deckRef.current = items.slice();
  lastOpenRef.current = true;
} else if (!open && lastOpenRef.current) {
  lastOpenRef.current = false;          // ← snapshot gate reset on close
}                                        //   but `cursor` is NOT reset here

useEffect(() => {
  if (open) {
    setCursor(0);                        // ← reset only runs AFTER render
    setOverrides({});
  }
}, [open]);
```

Then:

```tsx
// review-deck.tsx:168-188
const validIndices = useMemo(() => {
  return deckRef.current
    .map((it, i) => {
      const live = liveItemsById.get(it.id);
      if (!live) return i;
      if (live.status === "done") return null;
      if (live.needs_review !== true) return null;
      return i;
    })
    .filter((i): i is number => i != null);
}, [liveItemsById]);

const currentSnapshotIndex = validIndices[cursor];
const currentSnapshot =
  currentSnapshotIndex != null ? deckRef.current[currentSnapshotIndex] : undefined;
const current = currentSnapshot
  ? liveItemsById.get(currentSnapshot.id) ?? currentSnapshot
  : undefined;
```

And:

```tsx
// review-deck.tsx:466-475
if (!open) return null;
if (!current) {
  return (
    <Overlay onClose={onClose}>
      <DoneScreen onClose={onClose} count={deckRef.current.length} />
    </Overlay>
  );
}
```

### Why it fires

Reopen scenario, step by step:

1. Session 1: 63 items in Review. Deck opens, snapshot taken,
   `lastOpenRef.current = true`. User swipes all 63. `cursor = 63`.
2. User clicks "Back to board" → `setDeckOpen(false)`. Render with
   `open=false` resets `lastOpenRef.current = false`. **`cursor` stays at 63**
   (the `[open]` effect's guard `if (open)` short-circuits on close).
3. Sync runs in the background. 63 fresh items land in Review.
4. User clicks "Swipe". `setDeckOpen(true)`.
5. First render with `open=true`:
   - Snapshot guard passes (`!lastOpenRef.current`, `items.length=63>0`)
     → `deckRef.current` is a 63-item array, `lastOpenRef.current=true`.
   - `liveItemsById` has 63 entries; every entry has `needs_review=true`,
     no `done`s → `validIndices = [0..62]` (length 63).
   - `cursor` still **63** from step 1.
   - `currentSnapshotIndex = validIndices[63] = undefined`.
   - `current = undefined` → `<DoneScreen count={deckRef.current.length} />`
     → "Reviewed 63 items".
6. After commit, the `useEffect([open])` finally fires `setCursor(0)`.
   React schedules a second render where `current` resolves and the
   card mounts — but the user has already seen DoneScreen for a paint
   cycle, and depending on React 19's effect-flush ordering, long
   enough to register and click "Back to board".

The fact that `count = deckRef.current.length = 63` (matching what the
user sees in the badge) is the strongest tell that the snapshot itself
ran. The bug is purely in the read path.

### Fix-shaped diff (not applied)

```diff
- // src/components/s2d/review-deck.tsx:118-123
- if (open && !lastOpenRef.current && items.length > 0) {
-   deckRef.current = items.slice();
-   lastOpenRef.current = true;
- } else if (!open && lastOpenRef.current) {
-   lastOpenRef.current = false;
- }
+ if (open && !lastOpenRef.current && items.length > 0) {
+   deckRef.current = items.slice();
+   lastOpenRef.current = true;
+   // Reset cursor SYNCHRONOUSLY with the snapshot so the first render
+   // of a reopened deck can't paint DoneScreen using a stale cursor.
+   // React handles setState-during-render by re-rendering with the new
+   // state before commit; the post-commit useEffect[open] becomes a
+   // no-op for the cursor and only clears `overrides`.
+   if (cursor !== 0) setCursor(0);
+ } else if (!open && lastOpenRef.current) {
+   lastOpenRef.current = false;
+ }
```

Alternative (cleaner) shape: clamp the cursor at read time —
`Math.min(cursor, validIndices.length - 1)` — but that masks an
inconsistent state rather than correcting it.

Blast radius: tiny. Only path is reopening the deck after a completed
prior session. Test plan: open deck, swipe all items, click "Back to
board", trigger any sync that adds a Review item, click "Swipe" again →
should land on the new card, not on DoneScreen.

No migration needed.

## 3. Symptom B — root cause

There are **two** plausible writers of `status = "in_progress"` on items
the user didn't move themselves. They are independent; both probably
contribute.

### Path 3a — Triage `update` ops accept `in_progress`

The triage operation contract (`src/lib/triage/types.ts`):

```ts
// types.ts:19-46 — CREATE op restricts status to backlog/todo/in_queue
export interface TriageCreateOp {
  op: "create";
  ...
  status?: "backlog" | "todo" | "in_queue";
  ...
}

// types.ts:48-61 — UPDATE op ALLOWS in_progress
export interface TriageUpdateOp {
  op: "update";
  s2d_item_id: string;
  patch: Partial<{
    title: string;
    description: string;
    priority: Priority;
    pathway: Pathway;
    status: "backlog" | "todo" | "in_progress" | "in_queue";  // ← here
    queue_reason: string;
    est_minutes: number;
  }>;
  reason: string;
}
```

The orchestrator's update branch applies it verbatim with only one
guard (don't write to a row already `done`):

```ts
// src/lib/triage/orchestrator.ts:357-377
const { error } = await supabase
  .from("s2d_items")
  .update({
    ...
    ...(op.patch.status !== undefined && { status: op.patch.status }),
    ...
  })
  .eq("id", op.s2d_item_id)
  .eq("user_id", userId)
  .neq("status", "done");
```

Compare with the **close** branch, which has a 24h recent-touch guard:

```ts
// orchestrator.ts:386-400
const recentTouchIso = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
const { error } = await supabase
  .from("s2d_items")
  .update({ status: "done", ... })
  .eq("id", op.s2d_item_id)
  .eq("user_id", userId)
  .neq("status", "done")
  .lt("updated_at", recentTouchIso);
```

**The asymmetry is the bug.** Close has a grace window; update doesn't.
A re-triage 5 minutes after the user manually moved a heads_down item
to `todo` can silently re-stamp it to `in_progress`.

The triage system prompt (`src/lib/triage/prompts.ts:83-88`) defines
allowed *create* columns (todo / backlog / in_queue) but never tells
the agent which statuses are legitimate for *update* ops, so the agent
fills in from common sense — and Linear-sync presents the upstream
state name verbatim:

```ts
// src/lib/sync/linear-sync.ts:104, 145-146
status: it.state.name,             // upserted into linear_issues
...
const triageInput: IssueForTriage = {
  ...
  status: it.state.name,           // <-- the agent sees "Started", "In Progress" etc.
  ...
};
```

When the Linear issue's state name is "In Progress" / "Started" and the
agent is asked what to do with the existing Mashi item, the natural
move is `op: "update", patch: { status: "in_progress" }`. Focus-pathway
items are disproportionately Linear-sourced engineering work, which is
why they're the pathway the user notices.

There's no `triage_runs` audit query in this report because the project
isn't linked from this worktree. To confirm, run against prod:

```sql
-- Read-only. Limit recent so we don't pull history.
SELECT
  tr.created_at,
  tr.source_type,
  tr.source_unit_id,
  jsonb_path_query(tr.operations, '$[*] ? (@.op == "update")') AS op
FROM triage_runs tr
WHERE tr.created_at > now() - interval '14 days'
  AND tr.operations::text ILIKE '%in_progress%'
ORDER BY tr.created_at DESC
LIMIT 50;
```

And cross-reference:

```sql
SELECT id, ticket_number, title, pathway, status, created_at, updated_at
FROM s2d_items
WHERE status = 'in_progress'
  AND pathway = 'heads_down'
  AND updated_at > now() - interval '14 days'
ORDER BY updated_at DESC
LIMIT 25;
```

Items where `updated_at - created_at` is small and close in time to a
`triage_runs` row with an `in_progress` update op are the smoking gun
for path 3a.

### Path 3b — Sprint active-mode auto-flip with no revert

```tsx
// src/components/sprint/sprint-active-mode.tsx:92-97
// Mark current item in_progress on entry
useEffect(() => {
  if (!currentItem || currentItem.status === "in_progress") return;
  updateItem.mutate({ id: currentItem.id, patch: { status: "in_progress" } });
}, [currentItem?.id]);
```

```tsx
// src/components/sprint/sprint-active-mode-multi.tsx:222-232
const startedSetRef = useRef<Set<string>>(new Set());
useEffect(() => {
  for (const id of activeSlotIds) {
    if (startedSetRef.current.has(id)) continue;
    const it = itemMap.get(id);
    if (!it) continue;
    if (it.status !== "in_progress") {
      updateItem.mutate({ id, patch: { status: "in_progress" } });
    }
    startedSetRef.current.add(id);
  }
}, [activeSlotIds, itemMap, updateItem]);
```

Sprint flips items into `in_progress` when they enter an active slot.
The user thinks of this as "starting a sprint block on this item", not
as a board-level status change. If the user abandons the sprint
(closes, navigates away, browser tab dies), the item is left at
`in_progress` with no revert. Days later it's still sitting in the
In Progress column.

The "Delegate is fine, Focus is surprising" asymmetry in the report
makes sense in this framing: the user starts focus blocks on
heads_down work themselves, so this code fires on those items. They
don't run sprints on delegated items, so those paths only get
`in_progress` from external upstream mirrors, which the user has
internalized.

### Path 3c — Approval preserves AI status (minor contributor)

The deck's approve action keeps the AI's recommended status:

```ts
// review-deck.tsx:222-233
let status: S2DStatus = o.status ?? swipedItem.status;
...
if (action === "approve") {
  patch.needs_review = false;
  patch.status = status;
}
```

`TriageCreateOp.status` is typed `backlog | todo | in_queue` (no
`in_progress`), and the create branch defaults to `"todo"`:

```ts
// orchestrator.ts:313
const status = op.status ?? "todo";
```

But `op.status` comes from an LLM JSON response — there's no runtime
validation. If the model emits `status: "in_progress"` (out of TS
schema, but inside the DB's CHECK constraint), it lands as a Review
item with `status="in_progress"`. The deck's `Send to` dropdown only
offers `todo | backlog | in_queue` (review-deck.tsx:786-789), so the
user can't see or correct the recommended `in_progress` from the UI —
they just see `→ in_progress` rendered as text (line 714) and approve.

This is the weakest contributor of the three; runtime LLM output
adherence to the type schema is usually OK because the prompt
(prompts.ts:84-87) explicitly enumerates only todo/backlog/in_queue.
But the runtime gate is missing and worth closing.

## 4. Shared root cause

The symptoms aren't the same bug, but they share a discipline gap:

> **A status field on an S2D item is treated as cheap by writers
> (LLM update ops, sprint side-effects, optimistic mutations) and as
> authoritative by readers (the board column placement, the deck's
> `validIndices` filter). When the writers move faster than the
> readers can re-snapshot, the UI either lies (Symptom A) or
> surprises (Symptom B).**

The orchestrator's `.lt("updated_at", recentTouchIso)` on close
operations is the only place in the codebase that reifies the
principle "do not overwrite a user's recent intent". Every other
status writer skips it. That's the asymmetry to fix systemically once
the immediate Symptom A/B bugs are addressed.

## 5. Proposed fixes

### Fix A — reset cursor synchronously with snapshot

| Where | `src/components/s2d/review-deck.tsx:118-123` |
|---|---|
| What | On the same render that takes the snapshot, also `setCursor(0)`. |
| Blast radius | Tiny — single component, single path. |
| Test plan | Open deck → swipe all → "Back to board" → trigger sync that creates Review items → reopen. Should land on card 1 of N, not DoneScreen. |
| Migration? | No. |

### Fix B1 — disallow `in_progress` on triage update ops

| Where | `src/lib/triage/orchestrator.ts` update branch (~line 360-376), plus narrow `TriageUpdateOp.patch.status` in `src/lib/triage/types.ts:56` to `"backlog" | "todo" | "in_queue"`, plus prompt callout in `src/lib/triage/prompts.ts`. |
| What | (a) Type-narrow to forbid `in_progress`. (b) Add runtime guard: if `op.patch.status === "in_progress"`, drop the field, log to `triage_runs.input_summary.dropped_in_progress = true`. (c) Add a system-prompt line: "`in_progress` is reserved for the user / sprint mode. Never include it in an update op." |
| Blast radius | Affects every sync that calls `runTriageOnUnit`. Low risk — we're tightening allowed values. |
| Test plan | Manually inject a triage response with `patch.status="in_progress"` against a test item; confirm the field is dropped and the row's status doesn't change. Re-run linear-sync on an issue in "Started" state and confirm no `in_progress` writes appear in `triage_runs`. |
| Migration? | No. |

### Fix B2 — add the recent-touch guard to update ops

| Where | `src/lib/triage/orchestrator.ts:357-376` |
|---|---|
| What | Mirror the close branch: `.lt("updated_at", recentTouchIso)` on update ops that include a `status` change. Other fields (priority, pathway, queue_reason) can keep updating freely; only status is gated. |
| Blast radius | Could mask legitimate fast-following sync updates (e.g. Linear assignee change → user moves to todo → next sync sees "Started" upstream). Acceptable trade-off; the user explicitly cited this as surprising. |
| Test plan | Manually move an item to `todo`, immediately trigger a sync that would emit a status update — confirm the status update is dropped while non-status updates apply. |
| Migration? | No. |

### Fix B3 — revert sprint `in_progress` when slot is vacated

| Where | `src/components/sprint/sprint-active-mode.tsx` and `sprint-active-mode-multi.tsx`. |
|---|---|
| What | When an item leaves an active slot (sprint ended, user skipped/done'd it, user navigated away closing the sprint), revert its status from `in_progress` back to `todo` if it isn't already `done`. Need to be careful not to revert items the user explicitly wanted in-progress — perhaps tag the auto-flip with a marker (a `started_via_sprint_at` column) so revert is scoped to ones we flipped. |
| Blast radius | Touches the sprint flow; biggest risk is over-reverting. Adding a column is cheap, additive migration. |
| Test plan | Start sprint → confirm item shows `in_progress` on board. End sprint without marking item done → confirm item returns to `todo`. Manually set item to `in_progress` outside sprint → start sprint → end sprint → confirm item stays `in_progress`. |
| Migration? | Yes — additive column `started_via_sprint_at TIMESTAMPTZ` on `s2d_items`. |

### Fix C (optional) — gate `in_progress` on Review items in deck

| Where | `src/components/s2d/review-deck.tsx:222-233` |
|---|---|
| What | If `swipedItem.status === "in_progress"` and no user override was provided, coerce the approve target to `"todo"`. Belt-and-suspenders for Fix B1. |
| Blast radius | None. |
| Test plan | Construct a Review item with `status="in_progress"` (or arrive there via misbehaving triage). Approve. Confirm it lands in Todo. |
| Migration? | No. |

## 6. Recommended next step

**Ship Fix A first.** It's a 2-line change, the bug is contained to a
single component, the user has clearly reported it, and there's no
debate about what "correct" looks like. Doing it standalone also
proves out the diagnosis cheaply: if reopening the deck after a
completed prior session no longer shows DoneScreen, Symptom A's root
cause is confirmed.

Symptom B fixes should ship as a follow-up cluster: **Fix B1 + B2 + C
together** (single PR, all server-side except C). Hold Fix B3 for a
separate PR because it needs a migration and a more careful behavioral
review (the "started_via_sprint_at" interaction with the user's
manual in-progress moves wants design input, not a code fix).

Before shipping B1/B2: run the two SQL queries in §3 against prod to
confirm path 3a is actually firing. If `triage_runs` shows zero
in-progress update ops in the last 14 days, Path 3a is theoretical
and the priority of B1/B2 drops; B3 is the real fix.

## Out of scope but observed

- `useS2DItems`' `S2DRow` interface in `src/hooks/use-s2d.ts:36-64`
  is missing several columns the rest of the app reads off the row
  (`needs_review`, `ticket_number`, `review_justification`,
  `has_unseen_updates`, `last_update_summary`, `last_update_at`,
  `sprint_start_at`, `sprint_end_at`, `sprint_calendar_event_id`,
  `sprint_calendar_account_id`). The `select("*")` saves it at runtime,
  but the interface lies about the shape — anyone trusting the type
  to enumerate available fields will be surprised.

- `linear-pushback.ts:115-124` maps Mashi `in_progress` → Linear
  "started". So once Path 3a or 3b stamps `in_progress` on a Linear-
  sourced row, the next PATCH through `/api/s2d/[id]` will push that
  status back to Linear — meaning the upstream Linear ticket also gets
  flipped to Started without the user's intent. The blast radius of B
  is larger than just Mashi's board.
