# S2D task movement — what's broken, what's drifting, and how to fix it

The core promise of the S2D board is that tasks only move when you expect
them to, and when they do move on their own, you can see why and undo it
in one click. Right now that promise is breaking in three places. Two are
the bugs you reported (the false "queue cleared" message, and Focus items
appearing in In Progress you didn't put there). The third is brand new —
Activity Watcher shipped a confirm path that quietly bypasses the part of
the codebase that mirrors status back to Linear.

This plan covers all three together, because they share a single root
cause: too many things in the codebase write to a task's `status` field,
and they don't all play by the same rules.

---

## The three problems in plain English

### Problem 1 — "Review queue cleared" fires before you've reviewed anything

You open the swipe deck on the Review column with 63 items waiting. The
deck shows the "Reviewed 63 items, back to board" screen immediately —
even though you haven't swiped a single card.

What's actually happening: the swipe deck quietly remembers where you
left off the last time you used it. That memory (a number called the
cursor) never gets cleared when you close the deck. So if you finished
a deck a week ago — cursor sitting at 63 — and today you reopen with 63
brand-new items, the deck does the math "show me card number 63 out of
63" → "there is no card number 63, you must be done" → flashes the done
screen at you. There's code that's supposed to reset the cursor on
reopen, but it runs a beat too late, after the wrong screen has already
painted.

### Problem 2 — Focus items showing up in In Progress unsolicited

You see heads-down work in the In Progress column that you never moved
there. Delegate items in In Progress make sense to you (they're tracked
from someone else's side). Focus items don't.

Two things in the codebase write to In Progress without you asking:

The triage agent. When the AI re-reads an existing task (because new
context arrived — a Linear comment, a fresh email reply), it's allowed
to update the task's status. For new tasks it's restricted to todo /
backlog / in-queue. For existing tasks the restriction is missing —
the type signature literally includes "in_progress" as a legal value.
There's also no grace window. The "don't close something I just
touched" rule that exists on the close path doesn't exist on the
update path. So if you manually move a Focus item to todo and then a
sync runs 30 seconds later, the AI can shove it right back to in
progress, especially if it's a Linear ticket and the upstream Linear
state is "Started".

Sprint mode. When you start a sprint and an item enters an active
slot, sprint mode marks it In Progress on the board. That part is
intentional. The bug is what happens after. Nothing reverts it. If
the sprint ends, you close the tab, you walk away — the item stays
In Progress forever. You're "running a focus block" in your head; the
board is silently changing column state. Two different mental models,
zero feedback to you that this happened.

### Problem 3 — Activity Watcher's confirm path leaks state away from Linear

Activity Watcher (the new feature) does something smart: when it
detects you've been working on something (heartbeat from a Linear page,
a Gmail thread, a Slack channel), it proposes a status change instead
of making one. You see "looks like you've been working on this — mark
in progress?" and you click Yes or No. That's exactly the right
pattern.

But the Yes button bypasses the part of the codebase that pushes
Mashi status changes back to the original Linear ticket. So if you
confirm a watcher suggestion on a Linear-sourced item, Mashi shows
it as In Progress, but the Linear ticket stays in whatever state it
was in. Your teammates looking at Linear see the wrong thing. This
drift accumulates silently — there's no error, no warning, just two
systems quietly disagreeing.

The same Yes button also doesn't tag the item with how it moved (was
this manual? was this from the watcher?) and doesn't fire the "Mashi
touched this" pulsing dot that the rest of the codebase uses to draw
your attention.

### Problem 3b — Matcher v2's fuzzy tier is the riskiest path for Focus work

The latest Activity Watcher upgrade (Matcher v2) added a fuzzy
title-matching tier. When a heartbeat lands and no exact ID or URL
matches an item, the matcher now compares the heartbeat's title to
every open item's title using embeddings (or word overlap as a
fallback). If it crosses a similarity threshold, it suggests a status
change.

This tier is the most likely to produce false positives, and the
codebase already knows that — it runs at confidence 0.5 instead of
the 0.85 used by exact-match tiers, never proposes "done" (only "in
progress"), and backs off for 24 hours if you reject a fuzzy
suggestion on a specific item. All good defensive moves.

But the failure mode that remains is exactly Problem 2. A
0.5-confidence fuzzy suggestion to move a Focus task to In Progress
— maybe because you opened a Linear ticket whose title shares a few
words with a heads-down item — gets surfaced to you. You click
through quickly, the item moves, and now Focus work shows up in In
Progress unsolicited. Same end state as Problem 2, different writer.

The defenses in v2 (lower confidence, no fuzzy "done", reject
backoff) are the right shape but uniform across pathways. Focus
work has a much higher cost of being wrong than quick-reply work
does, and that's not yet reflected in the threshold.

---

## The pattern Activity Watcher got right

Before listing the fixes, it's worth naming what Activity Watcher
already nailed, because most of the cleanup is "make the rest of the
product work like this."

The matcher proposes; it never writes. Every proposal goes into a
queue with a confidence score, a plain-English reason, and snippets of
the underlying signal. You see the queue in the cockpit. You decide.
Items only move on an explicit click. There's a dedup window so the
same suggestion can't spam you every few minutes. There's a pause
button. There's a per-user opt-in. The queue has a lifecycle —
pending, confirmed, rejected, dismissed, expired — so nothing
disappears without a trace.

Everything in this plan that ends with "should move through the
suggestion queue" is shorthand for "do what Activity Watcher did, for
the other writers too."

---

## The full fix list, grouped by what they accomplish

### Group A — Stop the false "queue cleared" message

**A1.** Reset the swipe deck's cursor at the same moment it takes a
fresh snapshot of items. Two-line fix. Kills the symptom on the spot.

**A2.** Even with A1 in place, defensively clamp the cursor so it can
never point past the end of the deck. Belt and suspenders against any
future bug that desyncs the two.

**A3.** Don't show the "Reviewed N items" celebration screen unless
the user actually swiped at least one card. If they haven't, show
"All caught up" instead. Difference between "the deck worked and
ended" and "the deck never started."

**A4.** Make the deck a real component that mounts when you open it
and unmounts when you close it, rather than staying mounted forever
and just rendering null. Removes the entire category of "stale state
from a previous open" bugs in one motion.

**A5.** Change the deck's logic from "advance a cursor through a
snapshot" to "find the first un-swiped, un-closed card from the
snapshot." Removes the cursor entirely; the bug class can't exist.

**A6.** Make "deck is done" an actual piece of state that flips true
when the user finishes the queue, not something inferred from "no
current card found." Inferring done-ness from missing data is the
underlying vulnerability.

### Group B — Stop the silent moves to In Progress

**B1.** Forbid the AI from saying "move to in_progress" in update
operations. Tighten the type, drop the field at runtime if the AI
emits it anyway, and tell the agent in its prompt that in_progress
is reserved for the user and for sprint mode.

**B2.** Add a "don't overwrite recent user intent" rule to AI update
operations. The 24-hour grace window that already exists for closing
items should also gate status changes from updates.

**B3.** Revert sprint's auto-flip when the slot is vacated. Three
sub-pieces: revert items on explicit sprint end, tag the auto-flip
with a `started_via_sprint_at` timestamp so we know which items to
revert (don't touch items the user wanted in progress), and treat
"tab closed mid-sprint" as a delayed end after a cooldown.

**B4.** If somehow an in_progress status leaks onto a Review item,
coerce it to todo at the moment of approval in the swipe deck.
Belt-and-suspenders for B1.

**B5.** Add a database constraint that Review items literally cannot
have status=in_progress. If any code path tries to insert that
combination, the insert fails. Defense in depth.

**B6.** Pause Linear pushback for AI-driven and sprint-driven status
changes. Today, any Mashi status change pushes back to Linear. Gate
it on how the change happened — manual changes push, AI changes wait
for user confirmation.

**B7.** Bigger product question — should sprint-active items render
as a chip on the Todo column ("In sprint, 12 min elapsed") rather
than physically moving to a different column? That separates "I'm
focused on this right now" from "this is in progress on the board."

**B8.** The structural fix that subsumes B1 + B2 — route AI status
change proposals through the Activity Watcher suggestion queue
instead of applying them directly. The AI proposes; you confirm.
Same shape as the watcher already has, same UI, same trust model.

**B9.** Same shape for sprint mode. Instead of silently flipping
items to In Progress when they enter an active slot, sprint emits a
suggestion. You accept or ignore. If you ignore, the timer still
runs, the focus block still works, but the board doesn't lie.
Bigger product change than B3 but the right direction.

### Group C — Fix the new Activity Watcher drift

**C1.** Route the Activity Watcher confirm path through the same code
that all other manual status changes use. Picks up source tagging,
the pulsing "Mashi touched this" dot, the Linear push-back, and any
sprint state interactions — all for free.

**C2.** When confirming a watcher suggestion on a Linear-sourced
item, push the change back to Linear. Plug the silent drift between
Mashi and the upstream ticket.

**C3.** Enforce the watcher's "only suggest on non-Review items"
rule at the database level, not just in code. Pair with B5 — Review
items are off-limits to anyone trying to modify their status
automatically.

**C4.** Teach the matcher to consult recent user intent for ALL
match tiers, not just fuzzy. Matcher v2 backs off for 24 hours on
title_embed suggestions you've rejected on a specific item — extend
this to exact_id and url_match suggestions too, and also use the
signal "user just dragged item out of column X" as a reason not to
suggest moving it back to X. Cooldown window, same shape as the
existing 24-hour close grace.

**C5.** Per-pathway confidence floor on the matcher. Heads-down
(Focus) work needs a higher bar before the watcher will suggest
in_progress, especially on the fuzzy title_embed tier where the
current floor is 0.5. Concretely: title_embed should refuse to fire
on heads_down items below 0.85+ similarity. Quick-reply and other
low-cost-of-wrong pathways can stay at the current 0.5. The cost of
a wrong suggestion is much higher on focus work — exactly the
pathway you've been burned by, and the fuzzy tier is the new path
most likely to produce that exact failure.

**C5b.** Extend the "destructive moves need higher bars" rule
beyond fuzzy. Matcher v2 already refuses to propose "done" via the
fuzzy tier — because closing something feels destructive. Same logic
should apply to in_progress on heads_down items: it's a commitment-
shaped state change, not a casual one. Generalize the rule:
configurable per (pathway, proposed_state, signal_kind) so the
right floors and refusals live in one table instead of scattered
conditionals.

**C6.** Teach the matcher to know when an item is currently in an
active sprint slot. Don't suggest moving it; the sprint already
handles it.

**C7.** Fix the dangling references issue — activity events get
cleaned up after 7 days but older suggestions still link to them.
Cosmetic today, will burn someone trying to audit a 30-day-old
suggestion later.

**C8.** Pressure-test the existing defenses now that there are
three live heartbeat sources (cloud feeder, browser extension, Mac
helper) instead of one. Rate limiting (60 events/token/minute) is
in place — good. Ignore-lists are in place — good. The structured
logger from PR #37 is in place — useful for D6 (per-item history)
since we can lean on it rather than rebuilding. But the failure
modes worth checking with real traffic: do the three sources ever
fire on the same item within seconds and produce three suggestion
rows (the 30-min dedup should catch this, verify)? Does the Mac
helper polling at 1Hz produce signal_kind="focus" events that the
matcher correctly suppresses on already-in-progress items? Does
ignoring an app stop the heartbeat at the source AND filter
existing pending suggestions?

### Group D — Make every automatic status change visible and reversible

**D1.** Tag every row with how it last moved: manual, swipe approve,
triage update, triage create, sprint auto, activity confirm, linear
sync, reconcile auto, consolidate merge. Foundation for everything
else in this group.

**D2.** Flash the "Mashi touched this" pulsing dot on every
automatic status change. Today it fires on dedup merges and content
updates but not on status changes from the watcher or the AI. Should
fire on all of them.

**D3.** One-click undo on every automatic status change. Store the
previous status when the change happens so undo is a literal
restore, not an inference. Pair the undo with a "user rejected this
auto-move" marker so the same source can't redo it for a cooldown
window.

**D4.** Show a tiny chip on each board card indicating who last
moved it. Sparkles for AI, stopwatch for sprint, watcher icon for
activity watcher, nothing for user-driven. Glance at the In Progress
column, immediately see which items moved themselves.

**D5.** A daily "what Mashi did today" recap. Every confirmed
suggestion, every AI status update, every sprint auto-flip in the
last 24 hours, grouped by reason. You skim it, hit "looks right"
or click through to the surprising ones. Trust comes from seeing
the work, not from hoping there was less of it.

**D6.** Per-item history panel in the item sheet. Every status,
priority, pathway, assignment change with timestamp, source, and
reason. The data is mostly already in the activity suggestions
table — generalize it or build a small sibling table that all status
writers flow into. The structured logger added in PR #37 gives a
second source for this — every status write can emit a structured
log entry that the history panel reads from.

### Group E — Centralize the writers so the next bug can't ship invisibly

**E1.** Funnel every status write through a single function. Today
there are at least seven places that write status: orchestrator
create, orchestrator update, orchestrator close, sprint single,
sprint multi, swipe deck approve, drag-and-drop, the inline review
card, the s2d PATCH endpoint, the activity confirm endpoint. They
all become one-liners that call a shared `applyStatusChange(itemId,
newStatus, source, reason)`. That function enforces the recent-touch
rule, writes the audit row, fires the pulsing dot, calls Linear
pushback, decides whether to go direct or queue a suggestion.

**E2.** Generalize the 24-hour recent-touch grace window. Today
it's only on the AI close path. Apply it from the centralized writer
to every automatic source.

**E3.** Make the grace window per-source instead of blanket 24
hours. AI close = 24h, AI status update = 30 minutes, sprint revert
= 2 hours of inactivity. Each path picks a window that matches the
likely user intent window.

**E4.** Track "user explicitly moved this away from X" as a hint
the matcher and the AI both respect. If you dragged an item out of
In Progress, nothing automated puts it back in for 24-72 hours.
Manual moves are votes; the rest of the system should listen.

**E5.** Add database invariants that codify what the app assumes:
review items can't be in_progress, done items must have done_at set
(and vice versa), in_queue items must have a queue_reason, items
with a sprint start time can't be in backlog or done. Constraints
are the floor — they catch any code path that violates them at
insert time, loudly, instead of producing weird UI state.

### Group F — Tests so the next regression doesn't happen invisibly

**F1.** A regression test for each shipped fix. Each test reproduces
the broken behavior before the fix and passes after. These bugs are
too hard to spot in code review on the next refactor.

**F2.** A CI check that asserts the database invariants from E5 are
present in the live schema. If a future migration accidentally drops
one, CI fails.

**F3.** A property-based test for the orchestrator that generates
random sequences of operations and asserts: no user edit gets
silently overwritten, no item ends up in an invariant-violating
state, every status change has a recorded source.

**F4.** An end-to-end test for the full review-to-board flow.
Triage creates a review item with each pathway, user opens swipe
deck, approves, item lands in the expected column. Runs on every
PR. Catches the "review item has weird status that leaks into the
column placement" class of bug at integration level.

**F5.** A daily integrity job that scans the items table for
invariant violations and surfaces them in a debug dashboard. If
something drifts in prod despite constraints, it shows up within a
day instead of waiting for a user report.

### Group G — Cleanups we noticed along the way

**G1.** Fix the row type in `use-s2d.ts` that's missing about ten
columns the app reads. Either regenerate from Supabase or hand-add
the missing fields.

**G2.** Validate the AI's JSON output against the TypeScript schema
at runtime. Today the orchestrator parses and trusts. A zod schema
(or equivalent) catches the cases where the AI emits a value the
type system thinks is impossible.

**G3.** Decide whether the Review queue and the Pending Suggestions
queue stay as two separate surfaces or merge into one. They're
different lists today but you read them as "things I need to look
at." Either is fine; pick deliberately. If they stay separate, the
visual chrome should make the distinction crisp (different colors,
different verbs — "review" vs "confirm").

---

## What to ship and in what order

If the goal is to restore your trust in task movement as fast as
possible, ship in this sequence. Each step is a small, contained
change. After step 3 every user-reported symptom is gone and the new
Activity Watcher drift is plugged. After step 10 the structural work
is done and the next bug in this area can't ship invisibly.

1. **A1 and A3** — kill the false "queue cleared" today. Two-line
   change, one component, contained blast radius.
2. **C5 and C5b** — raise the fuzzy matcher's confidence floor on
   heads_down items and codify "destructive moves need higher bars"
   as a per-pathway/per-signal table. This is the highest-leverage
   step now that three heartbeat sources are live and the fuzzy tier
   is most likely to reproduce Symptom B.
3. **B5 and E5 and C3** — database constraints. Review items can't
   be in_progress, suggestions can't target review items, status
   transitions are validated at insert time. One migration, fast
   structural win.
4. **C1 and C2** — route the Activity Watcher confirm through the
   proper writer; push Linear updates on confirm. Plugs the new
   drift.
5. **B1 and B4** — type-narrow plus runtime guard against the AI
   ever writing in_progress on updates or creates.
6. **B2** — recent-touch grace window on AI status updates.
7. **B6** — gate Linear pushback on whether the change was manual.
8. **E1 and D1** — centralized status writer with source tagging.
   The hub for everything that follows.
9. **D2, D3, D4** — pulsing dot on auto-moves, one-click undo,
   source chips on cards. Trust through visibility.
10. **B3 (a and b)** — sprint revert with the `started_via_sprint_at`
    marker. Alternatively jump straight to B9 if there's appetite for
    the bigger product change.
11. **B8** — AI status proposals route through the suggestion queue
    instead of writing directly. There is now literally one path to
    an automatic status change and you always see it first.
12. **C4, C6, C8** — matcher consults recent user intent across all
    tiers, knows about sprint state, gets pressure-tested with real
    multi-source traffic.
13. **D5 and D6** — daily recap and per-item history.
14. **E2, E3, E4** — generalize the grace window, per-source
    windows, "moved away from" hint.
15. **F1 through F5** — tests, CI checks, integrity job.
16. **G1, G2, G3** — cleanups and the product call on whether
    Review and Pending merge.

Steps 1-3 are this week. Steps 4-10 are the structural work that
ensures the next status-related bug can't ship invisibly. Steps
11-15 are polish, tests, and product calls.

The single guiding principle behind all of this: **a task only
moves when you click, or when something proposes the move first and
you click on the proposal.** Everything in groups B, C, D, E is
either eliminating a path that breaks that principle, or making the
moves that do happen visible enough that you trust the system.
