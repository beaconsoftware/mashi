# Mashi Sprint Controls — Buildout Spec

## Status & lifecycle

- **Created**: 2026-05-26
- **Owner**: Sidd
- **Purpose**: Two surgical changes to the active-sprint UX. (A) Let the user pull more S2D items into the sprint without leaving the page. (B) Replace the "Exit" button with "End sprint" that takes the user to a review surface even mid-sprint, so they can decide dispositions for everything they didn't finish.
- **This document is TEMPORARY.** The final commit of this buildout deletes it (`rm MASHI_SPRINT_CONTROLS_BUILDOUT.md`). Do not let this doc outlive the project.

## Dependencies

None. This buildout is independent of `MASHI_AGENT_BUILDOUT.md` and `MASHI_FOCUS_CARD_BUILDOUT.md`. It can ship in parallel with either. No schema migration required.

## How to use this doc

Single-phase project (~1 day). The agent that picks this up:

1. Reads this doc in full.
2. Implements every acceptance criterion below.
3. Opens one PR titled "Sprint controls: Add-tasks picker + End-sprint review".
4. **Same PR deletes this doc (`git rm MASHI_SPRINT_CONTROLS_BUILDOUT.md`).** Confirm in PR description: "Removes MASHI_SPRINT_CONTROLS_BUILDOUT.md, sprint controls buildout complete."

---

# Part 1 — Problem

## Today's pain

**Adding items mid-sprint requires leaving the page.** The sprint takeover (`SprintActiveModeMulti` in `src/components/sprint/sprint-active-mode-multi.tsx`) renders a `FocusOverlay` with no entry point for pulling a fresh S2D item into the bench or an empty slot. If the user remembers a task they should have included, they have to:

1. Click Exit (which dumps everything they had).
2. Re-enter the planner.
3. Re-select all the original items + the new one.
4. Re-launch the sprint.

That's hostile. The bench and queue already exist; we just need a "+ Add" affordance that picks from the user's S2D items not currently in `blocks`.

**"Exit" is destructive and doesn't surface what got done.** [src/components/sprint/sprint-active-mode-multi.tsx:1002-1015](src/components/sprint/sprint-active-mode-multi.tsx:1002) hides "Exit" behind a `confirm()` dialog that just calls `exitSprint()` from the store. There's no recap. The `SprintComplete` review surface ([sprint-complete.tsx](src/components/sprint/sprint-complete.tsx)) only renders when every block is `done | skipped` (gated by `allSettled` in [sprint-global-mount.tsx:46-48](src/components/sprint/sprint-global-mount.tsx:46)). So a user who wants to wrap up mid-sprint loses both their work record AND the per-item disposition picker (Backlog / Snooze / Keep in To Do) that SprintComplete already implements.

What we want: an **"End sprint"** button that takes the user to the SprintComplete review surface regardless of block completion state. Pending blocks render as "Not done" rows with the same per-item disposition selector skipped blocks get today.

---

# Part 2 — Phase A: In-sprint "Add tasks" picker

## UX shape

A new **"+ Add tasks"** button in the sprint header next to Pause/Minimize/Exit at [sprint-active-mode-multi.tsx:987-1015](src/components/sprint/sprint-active-mode-multi.tsx:987). Clicking it opens a shadcn `Sheet` from the right side (use `<Sheet side="right">` from `src/components/ui/sheet.tsx`) containing a picker.

Picker contents:

- shadcn `Input` at the top for search (filters by `title` + `ticket_number`).
- Optional pathway filter chips (heads_down / quick_reply / decision_gate / watching / delegated / meeting_backed) — multi-select; default all on.
- Optional priority dot filter (P0 / P1 / P2 / P3).
- Result list: every `S2DItem` from `useS2DItems()` where:
  - `status` IN (`todo`, `in_queue`, `in_progress`) — exclude `done` / `dropped` / `backlog`.
  - `id` NOT IN `blocks.map(b => b.s2dItemId)` — exclude items already in this sprint.
- Each row renders the existing `<S2DItemCard>` summary plus a single primary action: **"Add to bench"**. When a slot is free, a secondary **"Add to slot N"** ghost button appears (where N is the next free index).
- After clicking, the row disappears from the picker; the sheet stays open so the user can add multiple items.

## Store changes

`src/store/sprint-store.ts` — add one action:

```ts
addItemMidSprint: (s2dItemId: string, target: "bench" | "active") => void;
```

Implementation:

- Resolve the item from a fresh `useS2DItems()` snapshot (the picker passes the id).
- Build a new `SprintBlock` for it:
  - `s2dItemId`
  - `startAt: new Date().toISOString()`
  - `durationMin`: default 30 (or pull from a user setting if one exists; today there's no per-item duration on S2DItem so 30 is fine).
  - `status: "pending"`
  - `activatedAtMs: null`, `accumulatedMs: 0`.
  - All `prewarm_*` fields default.
- If `target === "bench"`: append to `blocks`. The block is automatically picked up by the queued-blocks derivation in [sprint-active-mode-multi.tsx:239-244](src/components/sprint/sprint-active-mode-multi.tsx:239), so it shows up in the Bench strip.
- If `target === "active"`: append to `blocks` AND call `fillEmptySlot(activeSlotIds.length, s2dItemId)` if a slot is free. If no slot is free, fall through to bench (defensive).

Also PATCH `s2d_items` to `in_progress` if the item lands in an active slot (the existing `startedSetRef` effect at [sprint-active-mode-multi.tsx:251-261](src/components/sprint/sprint-active-mode-multi.tsx:251) handles this automatically; no change needed there).

## Prewarm

When a new block is added to the bench, the existing 90%-of-time prewarm trigger ([sprint-active-mode-multi.tsx:301-338](src/components/sprint/sprint-active-mode-multi.tsx:301)) handles warming when it becomes queue[0]. When added directly to an active slot, the activate-prewarm effect ([sprint-active-mode-multi.tsx:271-296](src/components/sprint/sprint-active-mode-multi.tsx:271)) handles it. No new prewarm code path.

## Files

**New:**
- `src/components/sprint/add-tasks-sheet.tsx` — the picker sheet. Self-contained: uses shadcn Sheet, Input, Button. Composes `<S2DItemCard>` for rows.

**Edited:**
- `src/components/sprint/sprint-active-mode-multi.tsx` — add the "+ Add tasks" button in the header row at lines 987-1015. State variable `addTasksOpen: boolean`. Renders `<AddTasksSheet open={addTasksOpen} onOpenChange={setAddTasksOpen} />`.
- `src/store/sprint-store.ts` — add `addItemMidSprint` action per above.

## Acceptance criteria

- [ ] "+ Add tasks" button appears in the sprint header, left of Pause.
- [ ] Clicking it opens a right-side Sheet with a searchable list of eligible S2D items.
- [ ] Search filters by title + ticket number.
- [ ] Pathway + priority chips filter the list.
- [ ] Items already in the sprint (any status) do not appear.
- [ ] Done / dropped / backlog items do not appear.
- [ ] Clicking "Add to bench" appends the item to the bench; the Bench strip updates without page reload.
- [ ] When a slot is free, "Add to slot N" also appears; clicking it puts the item directly into the slot and PATCHes the item to `in_progress`.
- [ ] After adding, the row disappears from the picker; the sheet stays open.
- [ ] Closing the sheet and reopening preserves filter state for the duration of the sprint session (Zustand transient state is fine).
- [ ] `pnpm verify` green; `pnpm audit:layers` green; `pnpm audit:translucency` green.

---

# Part 3 — Phase B: "End sprint" replaces "Exit"

## UX shape

The existing "Exit" button at [sprint-active-mode-multi.tsx:1002-1015](src/components/sprint/sprint-active-mode-multi.tsx:1002) is renamed and re-wired:

- **New label**: "End sprint" (not "Exit").
- **New behavior**: instead of `confirm() + exitSprint()`, it sets a new sprint phase `"complete"` and lets the existing `SprintComplete` recap surface render with all the user's work in view.
- **Force-show**: `SprintComplete` renders regardless of whether every block is settled. Pending blocks render as "Not done" rows with the same disposition selector skipped blocks get today.

Keep "Minimize" untouched — that's the "I'll come back to this" affordance and remains useful.

## Phase machine change

`src/store/sprint-store.ts` [line 25](src/store/sprint-store.ts:25):

```ts
export type SprintPhase =
  | "idle"
  | "prioritize"
  | "schedule"
  | "review"
  | "contract"
  | "active"
  | "minimized"
  | "complete";  // NEW
```

`SprintComplete` is currently rendered when `phase === "active" && allSettled` ([sprint-global-mount.tsx:46-50](src/components/sprint/sprint-global-mount.tsx:46)). After this change:

- `phase === "complete"` → render `SprintComplete` always.
- `phase === "active" && allSettled` → still render `SprintComplete` (auto-end on settle still works; rename `phase` to `complete` inside `completeBlock` when the last block settles, for consistency).

The same logic mirrors in `/sprint/page.tsx` ([app/sprint/page.tsx](src/app/sprint/page.tsx)) which renders its own SprintComplete instance.

## New store action: `endSprint`

```ts
endSprint: () => void;
```

Implementation:

- Settle any in-flight timer (call `tick()` first so live elapsed lands in `accumulatedMs`).
- Set `phase: "complete"`. **Do not mutate block statuses.** Pending blocks stay `pending`. `SprintComplete` reads them as such and treats them as "not done" rows.

Differ this from `exitSprint()` (the existing bail-everything-out action). `exitSprint` stays — it's now called from inside `SprintComplete`'s "Save & back to board" / "Save & plan another" buttons ([sprint-complete.tsx:444-463](src/components/sprint/sprint-complete.tsx:444)) per existing behavior.

## SprintComplete changes

[src/components/sprint/sprint-complete.tsx](src/components/sprint/sprint-complete.tsx) — minimal edits:

- The block-counts at line 73-78 already include `untouched = pending` blocks. Surface them in the header stat strip: `{done} done · {progressed?} progressed · {skipped} skipped · {untouched} not done` (progressed comes from the separately-tracked progress_log feature; if not yet shipped, omit).
- `OutcomeRow` at line 485 already takes `status: "pending" | "done" | "skipped"`. Pending rows render with neutral border (today line 503 only branches on `isDone`). Add a third lane: pending → `"border-amber-500/30 bg-amber-500/15"` (sanctioned `/15`/`/30`-adjacent translucency steps; verify against `pnpm audit:translucency` — if `/30` fails the audit, swap to `/40`).
- The disposition selector inside `OutcomeRow` already renders for non-done items ([sprint-complete.tsx:427](src/components/sprint/sprint-complete.tsx:427)) — works for pending without change.
- Add a small "End sprint summary" line near the header: `"Ended early with {untouched} items unfinished"` when `untouched > 0`. Skip when `untouched === 0` (natural completion path).
- The "Save & back to board" / "Save & plan another" buttons already PATCH dispositions and call `exitSprint()`. No change needed.

## Header button

[sprint-active-mode-multi.tsx:1002-1015](src/components/sprint/sprint-active-mode-multi.tsx:1002) — replace:

```tsx
<Button
  size="sm"
  variant="ghost"
  onClick={() => {
    if (confirm("Exit sprint? Progress on active items is saved.")) {
      exitSprint();
    }
  }}
  className="gap-1.5 text-destructive"
>
  <X className="h-3.5 w-3.5" />
  Exit
</Button>
```

with:

```tsx
<Button
  size="sm"
  variant="outline"
  onClick={() => endSprint()}
  className="gap-1.5"
  title="End the sprint and review what got done"
>
  <CheckCheck className="h-3.5 w-3.5" />
  End sprint
</Button>
```

(`CheckCheck` icon already imported from `lucide-react` in this file.)

No `confirm()` dialog — the review surface IS the confirmation step. The user can still cancel from there if they want (close the recap, sprint stays in `complete` phase but they can manually re-enter active via DevTools — or just hit "Save & back to board" which is non-destructive).

Also remove the Escape-key path that triggered exit at [sprint-active-mode-multi.tsx:898-906](src/components/sprint/sprint-active-mode-multi.tsx:898). Escape should no longer end the sprint — it's too easy to hit accidentally. Replace its behavior: if a detail panel is open, close it; otherwise, no-op.

## Cancel path

A user who hits End sprint by mistake should be able to back out. Add a "Back to sprint" button in the SprintComplete header (next to the existing close affordances) that:

- Sets `phase` back to `"active"`.
- Does NOT clear any work or dispositions.

Only show this button when `phase === "complete"` AND `!allSettled` (auto-completion lockout — if every block is done, there's no sprint to go back to).

## Files

**Edited:**
- `src/store/sprint-store.ts` — add `"complete"` phase, add `endSprint` action, add `goBackToActive` action for the cancel button.
- `src/components/sprint/sprint-active-mode-multi.tsx` — replace Exit button with End sprint, neuter Escape's exit behavior.
- `src/components/sprint/sprint-global-mount.tsx` — extend the SprintComplete gate to also fire on `phase === "complete"`.
- `src/app/sprint/page.tsx` — same gate extension.
- `src/components/sprint/sprint-complete.tsx` — add the pending-row treatment, the "End sprint summary" line, the "Back to sprint" button.

## Acceptance criteria

- [ ] The sprint header shows "End sprint" instead of "Exit" with a `CheckCheck` icon.
- [ ] Clicking End sprint with pending blocks routes immediately to the SprintComplete recap surface (no confirm dialog).
- [ ] Pending blocks render in the recap with amber styling and the per-item disposition selector (Backlog / Snooze / Keep in To Do).
- [ ] Done blocks render with the existing emerald styling.
- [ ] Header stat strip reads `{done} done · {skipped} skipped · {N} not done` when N > 0.
- [ ] The "End sprint summary" line surfaces when `untouched > 0`.
- [ ] "Save & back to board" persists dispositions and exits to /s2d.
- [ ] "Save & plan another" persists dispositions and routes back into the planner.
- [ ] "Back to sprint" button appears when there are pending blocks; clicking it returns to the active sprint with no data loss.
- [ ] Escape key no longer ends the sprint — it only closes an open detail panel.
- [ ] Auto-completion (every block done/skipped) still routes to SprintComplete (no regression of the natural completion path).
- [ ] `pnpm verify` green; `pnpm audit:layers` green; `pnpm audit:translucency` green.
- [ ] Visual baselines regenerated for /sprint.

---

# Part 4 — Doctrine compliance

- **shadcn-first** — Sheet, Input, Button, Tooltip from `src/components/ui/`. No hand-rolls.
- **Layout primitives** — the Sheet uses Radix's portal which by default lands in document.body. The sprint takeover is inside a FocusOverlay with `z-focus = 100`; the Sheet's default `z-modal = 150` correctly paints above it. If z-conflict surfaces (it shouldn't, given the documented scale), the fix is on the Sheet side, not the takeover.
- **Z-scale** — Sheet uses `z-modal`; sidebar stays above per the always-above-focus rule in AGENTS.md.
- **Translucency** — pending-row treatment uses sanctioned `/15`/`/40` steps. If `/30` is unsanctioned, swap to `/40`.
- **Motion** — Sheet open/close animation comes from shadcn defaults (Radix). No custom GSAP needed.
- **Multi-tenant RLS** — no new schema; everything reads/writes via existing TanStack Query hooks (`useS2DItems`, `useUpdateS2DItem`) which scope by `auth.uid()`.
- **No em-dashes** in user-facing copy.

---

# Part 5 — Risks + open questions

| Risk | Mitigation |
|---|---|
| Adding an item mid-sprint inflates the planned-total time after-the-fact, distorting the recap stats | Accept it. The recap stats are descriptive, not prescriptive. The user added the item intentionally. |
| `endSprint` mid-sprint with no work done feels like a "discard" path | Disposition selector defaults to "Keep in To Do", which is non-destructive. The Back-to-sprint button gives a clean undo. |
| Existing sprint sessions persisted to `/api/sprint/session` may not handle the `complete-without-allSettled` case | The session POST at [sprint-complete.tsx:283-301](src/components/sprint/sprint-complete.tsx:283) already maps each block to `done | skipped` based on its status. Pending blocks fall to `skipped` per the ternary — that's correct for session telemetry (the user told the sprint to end before finishing them). |
| The "+ Add tasks" picker pulls from `useS2DItems()` which is the full board — large user accounts may have hundreds of items | The list is virtualized by react-virtual if it exists in the stack, otherwise paginate at 50 with a "Load more" footer. Search + filter chips keep the visible set small in practice. |

## Deferred

- **AI-suggested adds** (the agent watches your sprint and proactively offers "you also have MASH-1234 that fits this 30 min slot") — out of scope. Lands once the agent buildout's Phase 4 spotlight surface ships.
- **Per-item duration override at add time** — Phase A defaults to 30 min. A duration selector in the row is a nice add-on but not required for v1.
- **Recap export** — saving the SprintComplete view as a markdown/PDF artifact. Out of scope.

---

**End of doc.** This commit deletes it. Do not let it outlive the project.
