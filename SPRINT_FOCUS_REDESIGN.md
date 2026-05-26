# Sprint Focus Mode — Redesign Spec

## Status & lifecycle

- **Created**: 2026-05-25
- **Owner**: Sidd
- **Purpose**: source of truth for the 6 PRs that reimagine sprint focus mode.
- **This document is TEMPORARY.** It exists to drive the redesign. **Phase 6's PR deletes it** (`rm SPRINT_FOCUS_REDESIGN.md` is part of that commit). Do not let this doc outlive the project.

## How to use this doc

1. **One unified prompt drives the whole project.** See [§ Unified phase-runner prompt](#unified-phase-runner-prompt) in Part 5. Spawn a fresh agent with that exact prompt; it self-routes to the next pending phase by reading the Progress tracker below.
2. **Fresh agent per phase** — do not continue the same agent across phases. Each agent runs exactly one phase and stops at PR open.
3. **Merge before spawning the next agent.** The agent refuses to start a new phase if a prior phase's PR is still open. The merge cycle is the human review step that keeps the project on rails.
4. Edit this doc liberally as decisions evolve. Phase 2's reality will likely change Phase 4's spec — capture that here, not in chat history.
5. **Phase 6 deletes this doc as part of its commit.** The agent running Phase 6 must verify this.

## Progress tracker

The unified prompt reads this table to decide what to do. The next phase to run is the first row with status `Pending`. When implementing a phase, the agent updates this row from `Pending` to `Shipped` with the PR URL **in the same commit** as the code. The merge brings the updated tracker to main; the next spawn sees the new state.

| Phase | Subject | Status | PR |
|---|---|---|---|
| 1 | Chrome reset — TimerRing + merged context + single About | Shipped | https://github.com/sidd-beacon/mashi/pull/90 |
| 2 | Reply + Decide canvases + Refine Sheet + decision_log | Shipped | https://github.com/sidd-beacon/mashi/pull/92 |
| 3 | Heads-down + Watching + Delegated canvases + watch_check_ins | Shipped | https://github.com/sidd-beacon/mashi/pull/93 |
| 4 | Meeting-prep canvas + pre-warm scheduler | Shipped | https://github.com/beaconsoftware/mashi/pull/95 |
| 5 | Contract card + Spawned Rail + sprint-complete rewrite | Shipped | https://github.com/beaconsoftware/mashi/pull/96 |
| 6 | Polish + DELETE THIS DOC | Pending | — |

**Status values**: `Pending` → `Shipped`. (No intermediate "In Review" — the open-PR check via `gh` covers that.)

**If all rows are `Shipped`**: the redesign is complete. The Phase 6 PR should have deleted this doc; if you're reading this, that PR hasn't merged yet.

---

# Part 1 — Problem

Sprint focus mode is the deepest screen in Mashi: a fullscreen takeover where the user commits to 1–3 time-boxed items and works heads-down until each is closed. The current pass underdelivers — not because of bugs, but because the structure is wrong.

## What's wrong, grounded in code

**It's a layout, not an experience.** The slot card today renders a 200px Sources Rail + flex-1 Tabs(Plan/Claude/Draft/Decide) workspace ([sprint-card-workspace.tsx:80-87](src/components/sprint/sprint-card-workspace.tsx:80)). Every pathway gets the same shape with a different default tab ([sprint-card-workspace.tsx:406-410](src/components/sprint/sprint-card-workspace.tsx:406)). The pathway is metadata; it should be the layout.

**The rail is suffocating.** A 200px column is asked to carry: item summary, an Enrich CTA, an enrich empty state, a cached-context section with its own heading, and pinnable sources. Two sections both labeled "About" stack on top of each other ([sprint-card-workspace.tsx:104-170](src/components/sprint/sprint-card-workspace.tsx:104)).

**The workspace is empty when the rail is loud.** When the user enters a slot, the canvas shows "Run Enrich to get a plan" or worse — a tab strip with no content under it. The instant the takeover opens, the right side should already be cooking.

**The pathway disappears inside the card.** Once you're in the slot, every item looks identical. A `decision_gate` feels like a `quick_reply` feels like a `heads_down`. Tiny 16px pathway badge is the only differentiator.

**Cached context and enriched context are treated as separate citizens.** They're not. The user thinks "what do I know about this item" — one knowledge layer, sorted by usefulness, not two boxes.

**The timer is a number in a corner, not a state.** `text-3xl tabular-nums` over a 2px progress bar ([sprint-active-mode-multi.tsx:1303-1337](src/components/sprint/sprint-active-mode-multi.tsx:1303)). The most important variable in focus mode is invisible most of the time.

## What good would look like

The pathway shapes the canvas. The timer shapes the chrome. Refine is one keystroke away from every shape. Sources merge into one ordered list. Pre-warmed agent work greets the user on slot entry, not after a click. Each slot exit produces a visible artifact — a sent message, a logged decision, a spawned follow-up — that lands in a "Spawned" rail at the bottom of the takeover. The sprint isn't a punch list; it's a session that produces a chain of moves.

---

# Part 2 — Proposed solution

## IA decision

**Pathway-shaped canvases** as the spine of the slot. The 7 pathways collapse into 7 distinct canvas components dispatched from a single `<PathwayCanvas>`. There is no tabbed workspace.

- `quick_reply` + `drafted_response` → `<ReplyCanvas>`
- `decision_gate` → `<DecideCanvas>` (with Yes / Yes-but / No / Defer; Yes-but spawns a follow-up)
- `heads_down` → `<HeadsDownCanvas>`
- `meeting_backed` → `<MeetingPrepCanvas>`
- `delegated` → `<DelegateCanvas>`
- `watching` → `<WatchCanvas>` (with **Still watching** check-in + **Stop watching** terminal exits)

**Timer-as-ring chrome.** Each slot is bounded by a pathway-tinted ring that fills as time elapses. The ring shimmers in pathway color while the agent is pre-warming. The number lives small in the corner.

**Refine sheet as a layer.** Natural-language chat with the agent is one global slide-up `Sheet`, summoned by `/` or `⌥+R`. Hosts the refine textarea, recent turns, merged source list (pinned > pulled > cached), pin/unpin. Replaces the inline `RefineThread` from `sprint-card-workspace.tsx`.

**Ambient album tint.** Spotify album palette tints each card's translucent fill via a CSS variable. The ambient ground stops being decoration and becomes part of the card's mood.

## Per-pathway feature map

### ⚡ quick_reply
- **Mental model**: I owe someone a short answer. Get me to Send in under 5 min.
- **Pre-warm**: stream a draft reply using voice profile + last 3 messages of the thread.
- **Canvas**: inbound snippet (top) · editable draft (middle) · tone/length controls + Send (bottom).
- **Ambient sources**: only the inbound thread. Refine sheet on demand.
- **Exits**: Send (auto-spawns `watching` follow-up, 48h) · Save & Skip · Bench · Snooze 24h · Detail.

### ✎ drafted_response
- Same skeleton as quick_reply, heavier UI.
- Per-paragraph regenerate/shorten/expand controls.
- Versioning drawer ("v3 of 5").
- Read-aloud button.

### ◆ decision_gate
- **Mental model**: I'm using this slot to force a commitment.
- **Pre-warm (opt-in, ~$0.05)**: 4-option brief — Yes/No bullets + pre-mortem + pre-parade + Yes-but condition candidates + Defer trigger candidates.
- **Canvas**: 2x2 grid of choice cards (Yes / Yes-but / No / Defer), each with its own note textarea. Yes-but card has a `condition` field. Defer card has date + trigger fields.
- **Ambient sources**: "What you know" strip with decision-relevant snippets (agent extracts).
- **Exits**: Decide Yes (logs decision_log) · Decide Yes-but (logs + **spawns new s2d_item** with the condition) · Decide No · Defer · Skip · Bench.

### ◉ heads_down
- **Mental model**: I'll do the work elsewhere (Claude Desktop, code, doc). Mashi launches me and catches the output.
- **Pre-warm**: 3-step plan + handoff prompt bundling description + pinned sources + plan.
- **Canvas**: plan with checkboxes (top half) · big "Open in Claude Desktop" + "Copy prompt" buttons (middle) · "What did you produce?" capture textarea (bottom).
- **Exits**: Done (persists outcome) · Continue tomorrow · Bench · Skip · Spawn follow-up.

### ◷ meeting_backed
- **Mental model**: Not doing this now. Prepping it for a specific meeting.
- **Pre-warm**: match candidate calendar events from attendees/title; draft talking points.
- **Canvas**: meeting picker (top) · talking-points textarea, drag-reorderable bullets (middle) · "Add to meeting agenda" button (bottom).
- **Exits**: Staged for meeting (sets `calendar_event_id`) · Re-pathway · Skip · Bench · Snooze.

### → delegated
- **Mental model**: Someone else owns this. Did they move it?
- **Pre-warm**: scan delegate's activity since handoff (messages/Linear/calendar). Draft nudge if stale by urgency-based threshold.
- **Canvas**: who/when/last-heard (top) · activity timeline (middle) · action set with "Send nudge" expander, tone slider Gentle/Direct/Escalate (bottom).
- **Exits**: Send nudge (NOT terminal — timer keeps running) · Resolved · Re-assign · Pull back · Check again tomorrow · Skip · Bench.

### ○ watching
- **Mental model**: Already acted. Has anything happened?
- **Pre-warm**: scan linked + keyword-matched sources for activity since item entered watching. Honest about silence.
- **Canvas**: "Watching for: [editable]" (top) · activity-since-last list, empty state honest (middle) · action set (bottom).
- **Exits**:
  - **Still watching** — logs `watch_check_ins` row with `continued=true`; item stays in_queue; slot promotes next. **This is the check-in pattern.**
  - **Resolved** — done with outcome.
  - **Stop watching** — done with `resolved_via='abandoned'`.
  - **Promote to action** — re-pathway to `quick_reply` or `decision_gate`.
  - Bench · Snooze.

### Shared affordances across pathways

| Affordance | quick_reply | drafted | decide | heads_down | meeting | delegated | watching |
|---|---|---|---|---|---|---|---|
| Refine sheet | Link | Chip | Chip | Always-visible CTA | Chip | Link | Always-visible CTA |
| Source list | Hidden | Chip | Under canvas | Counter strip | Side strip | Side strip | Top of canvas |
| Pin / unpin | In sheet | In sheet | In source list | In sheet | In sheet | In sheet | In activity list |
| Detail (full sheet) | ⌘+. | ⌘+. | ⌘+. | ⌘+. | ⌘+. | ⌘+. | ⌘+. |
| Spawn follow-up | Auto on Send | Auto on Send | Auto on Yes-but / Resolved | Manual | Manual | Auto on Resolved | Manual (Promote) |
| Re-pathway | Available | Available | Available | Available | Available | Available | Available |

## The reimagined arc

### Phase A — Commit (replaces planner-schedule's final step)
After scheduling, before launch, the user sees a **Contract Card**:
- Sprint shape ribbon (pathway glyphs in order).
- One-line success statement per item ("At the end you will have…") — Mashi pre-fills, user edits.
- Pre-warm preview per item — cheap pathways listed as "free"; decision items have a per-item opt-in checkbox with cost.
- Two buttons: "Edit shape" (back to scheduler) and "Start sprint →".
- Pre-warm of slots 1–3 begins **on contract-card mount** so by the time the user clicks Start, the canvases are cooked.

### Phase B — Enter
Cockpit + Crew takeover (unchanged shell). The focused slot is pathway-shaped; the two crew slots are quieter (pathway glyph 32px, title, timer ring, no canvas).

### Phase C — Move
User works in the focused slot. Pre-warm content greets them. Refine sheet `/` away. Re-pathway `⌥+P` away. Primary action fires per pathway.

### Phase D — Transition
Slot exit plays a 1.5s **Acknowledgement** micro-state showing what just happened + any spawned artifacts. Next queued slot promotes with a slide-in. If pre-warm isn't ready on the promoted item, it shows pathway-tinted "warming" copy ("Building the brief…", "Drafting reply…").

### Phase E — End
Sprint-complete recap is **outcome-shaped**: success_statement ↔ outcome per item, full spawn chain visible, watch check-ins surfaced, top Spotify track if any. Tells the story of the sprint.

---

# Part 3 — Cross-cutting contracts

These specs are referenced by multiple phases.

## `<PathwayCanvas>` — the dispatcher

`src/components/sprint/canvases/pathway-canvas.tsx`

```ts
interface PathwayCanvasProps {
  item: S2DItem;
  block: SprintBlock;
  slotIdx: number;
  active: boolean;
  prewarm: PrewarmState;
  onExit: (exit: SlotExit) => Promise<void>;
}

type SlotExit =
  | { kind: "done"; outcome?: string }
  | { kind: "skip" }
  | { kind: "bench" }
  | { kind: "snooze"; until: string }
  | { kind: "send"; channel: "gmail" | "slack"; body: string; spawnsWatchItem: boolean }
  | { kind: "decide"; choice: "yes" | "yes-but" | "no" | "defer"; note: string; condition?: string; deferUntil?: string }
  | { kind: "check-in"; note?: string; continue: boolean }
  | { kind: "stage-meeting"; calendarEventId: string; talkingPoints: string }
  | { kind: "nudge-delegate"; channel: "gmail" | "slack"; body: string }
  | { kind: "repathway"; newPathway: Pathway };

interface PrewarmState {
  status: "pending" | "warming" | "ready" | "skipped" | "failed";
  error?: string;
  completedAt?: string;
}
```

Dispatcher logic:
```ts
switch (item.pathway) {
  case "quick_reply":
  case "drafted_response":  return <ReplyCanvas ... />;
  case "decision_gate":      return <DecideCanvas ... />;
  case "heads_down":         return <HeadsDownCanvas ... />;
  case "meeting_backed":     return <MeetingPrepCanvas ... />;
  case "delegated":          return <DelegateCanvas ... />;
  case "watching":           return <WatchCanvas ... />;
}
```

## `<TimerRing>` — bounding chrome

`src/components/sprint/timer-ring.tsx`

```ts
interface TimerRingProps {
  elapsedMs: number;
  totalMs: number;
  overrunMs: number;
  pathway: Pathway;
  warming?: boolean;
  paused: boolean;
  children: React.ReactNode;
}
```

Implementation:
- SVG ring sized to its container via `ResizeObserver`.
- Stroke = `hsl(var(--pw-${pathway}))`.
- Dasharray driven by `elapsedMs / totalMs`.
- Overrun: stroke shifts to `var(--destructive)`; ring keeps drawing past 360° as a second pass.
- Warming: a ~30° arc highlight rotates at 1.5s/rev.
- Paused: ring dims to 50% alpha.
- All transitions wrapped in `withMotion` from `src/lib/animation/index.ts`.

## `<RefineSheet>` — global slide-up

`src/components/sprint/refine-sheet.tsx`

```ts
// State lives in a Zustand slice: src/store/refine-sheet-store.ts
interface RefineSheetState {
  open: boolean;
  boundItemId: string | null;
  openFor: (itemId: string) => void;
  close: () => void;
}
```

- Composes shadcn `Sheet` with `side="bottom"`.
- Renders: refine textarea (Textarea primitive) sending via `useRunEnrich(boundItemId)`; refine turns list from `enriched_context.thread`; merged source list with pin/unpin.
- Summoned via `/` or `⌥+R` from any focused slot.
- Esc closes.

## `<SpawnedRail>` — bottom-of-takeover artifact strip

`src/components/sprint/spawned-rail.tsx` + `src/store/spawned-rail-store.ts`

```ts
interface SpawnedArtifact {
  id: string;
  kind: "sent" | "decision" | "follow-up" | "check-in" | "nudge" | "staged-meeting";
  itemId?: string;
  spawnedItemId?: string;
  label: string;
  detail: string;
  at: string;
}
```

- Bottom strip of `FocusOverlay`, above sidebar's bottom margin.
- 36px when empty (shows "Sprint will collect artifacts here"), 48px when populated.
- Horizontally scrollable. Each chip → shadcn `HoverCard` peek with "View" button.

## Pre-warm scheduler

`src/lib/sprint/prewarm-scheduler.ts`

```ts
export function schedulePrewarm(opts: {
  block: SprintBlock;
  item: S2DItem;
  reason: "activate" | "queued-soon" | "repathway";
}): void;
```

Behavior:
- Per-block in-flight map keyed by `block.id`, dedupes.
- Each call POSTs to `/api/sprint/prewarm` with `{ itemId, pathway, reason }`.
- Server runs the work and writes to `enriched_context` + `sprint_blocks.prewarm_status` (or store-equivalent if blocks are client-side).
- Client polls `useEnrichedContext(itemId)` at 2s while `prewarm_status === 'warming'`.

Triggers:
- `startSprint`: warm slots 1–3 immediately. (Contract card already started slot 1's warm at mount.)
- Every tick: if active slot's `elapsedMs / totalMs >= 0.9` and queue has items, warm `queue[0]`.
- `completeBlock` (promotes queued): if promoted block is `pending`, warm now.
- `repathway`: mark `pending`, warm.

Gating:
- `decision_gate` pre-warm only fires when `block.prewarm_opt_in === true` (set at contract card).
- All others run by default.

## Keyboard map

Bound at `<SprintActiveModeMulti>` level via one `useEffect` listener:

| Key | Action |
|---|---|
| `1`/`2`/`3` | `focusSlot(slotIds[N-1])` |
| `Tab` / `Shift+Tab` | cycle focused slot |
| `Enter` | fire primary action for focused slot |
| `D` | Done dispatch (decide opens choice picker) |
| `S` | Skip · `B` Bench · `N` Snooze |
| `/` or `⌥+R` | `refineSheet.openFor(focusedItemId)` |
| `⌥+P` | open re-pathway popover |
| `⌘+.` | open detail sheet |
| `Esc` | close topmost (sheet → popover → defocus slot) |

## Doctrine compliance (every phase)

- shadcn primitives only — no hand-rolled buttons/inputs/dialogs/popovers ([AGENTS.md](AGENTS.md) — "Component library doctrine").
- Z-scale via `Z.*` / `z-*` utility classes only.
- Translucency: sanctioned steps `/15 /40 /55 /60 /80 /95` (file-level `translucency-audit-ok` carve-outs allowed where existing code requires migration; new code must use the scale).
- Motion via `DUR.*` + `EASE.*` + `withMotion()`. GSAP for hero entries; CSS utilities (`mashi-magnetic`, `mashi-lift`, `mashi-press`, `mashi-icon-glow`) for recurring polish.
- Every new component → `pnpm verify` green (`tsc --noEmit && eslint`), `pnpm audit:layers` green, `pnpm audit:translucency` green.

---

# Part 4 — Phase specs

Each phase below is a complete PR brief. The agent implementing it should be able to execute solely from this section + the cross-cutting contracts above.

## Phase 1 — Chrome reset (TimerRing + merged context + single About)

### Goal
Focus mode *looks* like focus mode. No behavioral changes. The tab strip still functions; only chrome is replaced.

### Estimated effort
~2 days.

### Files

**New:**
- `src/components/sprint/timer-ring.tsx`
- `src/lib/sprint/merge-sources.ts`

**Edited:**
- `src/components/sprint/sprint-active-mode-multi.tsx` — replace slot border + sliver with `<TimerRing>` wrapping the slot body.
- `src/components/sprint/sprint-card-workspace.tsx` — collapse two "About" blocks into one identity strip; render `<MergedSourceList>` instead of separate `<PulledSources>` + `<SprintItemContext>`.
- `src/components/sprint/sprint-item-context.tsx` — refactor: expose `useCachedContextSignals(item, enabled)` hook (no JSX); the component-form stays for detail sheet.

### `<MergedSourceList>` contract

```ts
interface Props {
  itemId: string;
  enabled: boolean;
  variant: "rail" | "below-canvas" | "side-strip";
}
```

Algorithm (in `merge-sources.ts`):
1. Take enriched `pulled_sources` (kind, ref, label, when, pinned, snippet).
2. Take cached signals from `useCachedContextSignals`; project to same shape (synthesize `ref` from `source_type:source_thread_id`).
3. Dedupe by `kind:ref`.
4. Sort: pinned first, then `when` desc, cached after pulled when timestamps tie.

### Identity strip (replaces two "About" blocks)

```
┌─ ◆ Decision · urgent · Beacon · MASH-1408 ──── 06:48 ─┐
│  Approve $40k spend on Q4 brand campaign?              │
│  Quick context: Last decision on brand was Sept 2025…  │
└────────────────────────────────────────────────────────┘
```

Single header above the workspace. Uses `<SectionHeader>` primitive.

### Motion
- TimerRing fill: `gsap.to(ring, { strokeDashoffset: …, duration: DUR.short, ease: EASE.out })` driven by the existing 1s tick.
- Identity strip mount: existing `heroEntry` reused.

### Acceptance criteria
- [ ] Each active slot is bounded by a pathway-tinted ring; no `border-primary/40` on the slot root.
- [ ] No more `h-0.5` progress sliver in the slot body.
- [ ] Slot header shows ONE identity block (title + 1-line context).
- [ ] Source list shows ONE merged section; pinned items float to top regardless of origin.
- [ ] All existing slot behaviors (drag, swap, done/skip/bench/snooze, detail) still work.
- [ ] `pnpm verify` green; `pnpm audit:layers` green; `pnpm audit:translucency` green.
- [ ] Visual baselines updated (`pnpm test:visual:update` + committed PNGs).
- [ ] Progress tracker row for Phase 1 updated from `Pending` to `Shipped` with this PR's URL, in the same commit as the code.

### End-of-PR reminder (agent MUST include verbatim in its final user-facing message)

> ✅ **Phase 1 complete.** Next steps for Sidd:
> 1. Review the diff and merge this PR when satisfied.
> 2. **Terminate this agent session** — do not continue it.
> 3. Spawn a fresh agent with the **Unified phase-runner prompt** from `SPRINT_FOCUS_REDESIGN.md` § Part 5. It will self-route to Phase 2 by reading the Progress tracker on main.
>
> Continuing this session into Phase 2 carries accumulated context that should not bleed forward. Fresh agents per phase are non-negotiable per the project plan.

---

## Phase 2 — Reply + Decide canvases + Refine Sheet + decision_log

### Goal
The two highest-action pathways feel native. Tabs strip is removed for these two pathways (kept temporarily for others).

### Estimated effort
~3 days.

### Migrations

**`supabase/migrations/029_decision_log.sql`** — additive only.

```sql
ALTER TABLE public.s2d_items
  ADD COLUMN IF NOT EXISTS decision_log JSONB NULL,
  ADD COLUMN IF NOT EXISTS spawned_from_item_id UUID NULL
    REFERENCES public.s2d_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS spawn_reason TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_s2d_items_spawned_from
  ON public.s2d_items(spawned_from_item_id)
  WHERE spawned_from_item_id IS NOT NULL;

COMMENT ON COLUMN public.s2d_items.decision_log IS
  'For decision_gate items: { choice, note, condition?, deferUntil?, followUpItemId?, sourcesCited, decidedAt }';
```

`decision_log` JSONB shape:
```ts
interface DecisionLog {
  choice: "yes" | "yes-but" | "no" | "defer";
  note: string;
  condition?: string;
  deferUntil?: string;
  followUpItemId?: string;
  sourcesCited: Array<{ kind: EnrichSourceKind; ref: string; label: string }>;
  decidedAt: string;
}
```

### Files

**New:**
- `src/components/sprint/canvases/pathway-canvas.tsx`
- `src/components/sprint/canvases/reply-canvas.tsx`
- `src/components/sprint/canvases/decide-canvas.tsx`
- `src/components/sprint/canvases/_shared/canvas-shell.tsx` — header (identity + pathway glyph 32px) + footer (action button + Skip/Bench/Snooze/Detail).
- `src/components/sprint/refine-sheet.tsx`
- `src/store/refine-sheet-store.ts`
- `src/store/spawned-rail-store.ts` (scaffold; UI in Phase 5).
- `src/app/api/s2d/[itemId]/decision/route.ts` — POST writes `decision_log` + spawns follow-up.
- `src/app/api/s2d/[itemId]/spawn-follow-up/route.ts` — POST creates new s2d_item with `spawned_from_item_id`.
- `src/lib/anthropic/decide-brief.ts` — generates 4-option brief.

**Edited:**
- `src/components/sprint/sprint-card-workspace.tsx` — Reply/Decide pathways route through `<PathwayCanvas>`; tabs strip stays only for other pathways (transitional).
- `src/components/sprint/sprint-active-mode-multi.tsx` — wire `/` and `⌥+R` keyboard shortcuts.

### `<ReplyCanvas>` contract

```ts
interface ReplyCanvasProps extends CanvasBaseProps {
  inbound?: InboundMessage;
  voiceProfile?: VoiceProfile;
}
```

Layout:
- Top: inbound snippet (3 lines, expandable). Sender + when.
- Middle: editable Textarea prepopulated by `useReplyDraft(item)` streaming from `/api/sprint/draft-reply`.
- Bottom: tone toggle (4 pills: Direct/Warm/Brief/Detailed), length slider (Short/Standard/Long), Regenerate icon, **Send →** primary button (Gmail/Slack icon baked in).

Send fires `onExit({ kind: "send", channel, body, spawnsWatchItem: true })`. Default `spawnsWatchItem = true`; small checkbox above Send disables per send.

### `<DecideCanvas>` contract

```ts
interface DecideCanvasProps extends CanvasBaseProps {
  brief?: DecisionBrief;
}

interface DecisionBrief {
  yes:    { whyBullets: string[]; preParadeLine: string };
  no:     { whyBullets: string[]; preMortemLine: string };
  yesBut: { conditions: string[] };
  defer:  { triggerCandidates: string[] };
  sourcesCited: SourceRef[];
}
```

Layout:
- Top: question (item.title).
- Middle: 2x2 grid of 4 choice cards. Each has textarea + agent-suggested bullets. Yes-but card has `condition` field. Defer card has date + trigger fields.
- Bottom: "What you know" strip — 3–5 sources with decision-relevant snippets, one-tap pin/unpin.

On `decide` exit:
1. POST `/api/s2d/{id}/decision` with the full decision_log payload.
2. Server writes `s2d_items.decision_log`, marks status `done`.
3. If choice is `yes-but`, server also creates a follow-up item and returns `{ decision, followUp }`.
4. Client adds two artifacts to spawned-rail store (decision + follow-up).
5. Simple toast for now; acknowledgement micro-state lands in Phase 6.

### Pre-warm
- Reply: `/api/sprint/prewarm` streams to `enriched_context.reply_draft` (JSONB field — additive on existing column).
- Decide: only if `prewarm_opt_in`; calls `decide-brief.ts` → writes to `enriched_context.decision_brief`.

### Acceptance criteria
- [ ] Quick-reply slots no longer show Plan/Claude/Draft/Decide tabs.
- [ ] On slot activation, draft begins streaming within 1.5s (cold) or appears instantly (cached pre-warm).
- [ ] Tone + length controls regenerate the draft.
- [ ] Send fires Gmail/Slack POST; on 200, item marks done and a `watching` follow-up s2d_item is created with `queue_until = now + 48h`, `spawn_reason = "post-reply-watch"`.
- [ ] Decision slots show 4-card grid (with "Build brief" CTA if pre-warm wasn't opted in).
- [ ] Yes-but writes `decision_log.condition` + creates follow-up item visible in s2d board.
- [ ] Refine sheet opens via `/` or `⌥+R` from any active slot; pinning persists; Esc closes.
- [ ] `decision_log` row queryable.
- [ ] Migration 029 applied to local DB and CI green on push.
- [ ] Progress tracker row for Phase 2 updated from `Pending` to `Shipped` with this PR's URL, in the same commit as the code.

### End-of-PR reminder (agent MUST include verbatim)

> ✅ **Phase 2 complete.** Next steps for Sidd:
> 1. Review the diff and merge this PR when satisfied.
> 2. **Terminate this agent session** — do not continue it.
> 3. Spawn a fresh agent with the **Unified phase-runner prompt** from `SPRINT_FOCUS_REDESIGN.md` § Part 5. It will self-route to Phase 3 by reading the Progress tracker on main.
>
> Continuing this session into Phase 3 carries accumulated context that should not bleed forward.

---

## Phase 3 — Heads-down + Watching + Delegated canvases + watch_check_ins

### Goal
All action-shaped pathways are native. Watching gets its check-in trail.

### Estimated effort
~3 days.

### Migrations

**`supabase/migrations/030_watch_check_ins.sql`**:

```sql
CREATE TABLE IF NOT EXISTS public.watch_check_ins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT auth.uid()
    REFERENCES auth.users(id) ON DELETE CASCADE,
  s2d_item_id UUID NOT NULL
    REFERENCES public.s2d_items(id) ON DELETE CASCADE,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  note TEXT NULL,
  signals_since_last JSONB NULL,
  continued BOOLEAN NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_watch_check_ins_item
  ON public.watch_check_ins(s2d_item_id, at DESC);

ALTER TABLE public.watch_check_ins ENABLE ROW LEVEL SECURITY;
CREATE POLICY watch_check_ins_owner ON public.watch_check_ins
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
```

### Files

**New:**
- `src/components/sprint/canvases/heads-down-canvas.tsx`
- `src/components/sprint/canvases/watch-canvas.tsx`
- `src/components/sprint/canvases/delegate-canvas.tsx`
- `src/app/api/s2d/[itemId]/check-in/route.ts`
- `src/app/api/s2d/[itemId]/nudge/route.ts`
- `src/lib/sprint/activity-scan.ts` — server util.
- `src/lib/anthropic/heads-down-plan.ts`
- `src/hooks/use-watch-check-ins.ts`

**Edited:**
- `src/components/sprint/canvases/pathway-canvas.tsx` — dispatch the three new canvases.
- `src/components/sprint/sprint-card-workspace.tsx` — remove these three pathways from the tabs fallback.

### `<HeadsDownCanvas>` contract

```ts
interface HeadsDownProps extends CanvasBaseProps {
  plan?: PlanStep[];
  handoffPrompt?: string;
}
interface PlanStep { id: string; text: string; checked: boolean; }
```

Layout: plan checklist (top half) · "Open in Claude Desktop" (`claude-desktop://` deep link) + "Copy prompt" buttons (middle) · "What did you produce?" textarea (bottom).

On Done: persist capture to `outcome`. If empty, prompt "One line on what you got done?" with skip option.

### `<WatchCanvas>` contract

```ts
interface WatchProps extends CanvasBaseProps {
  watchFor?: string;
  signalsSinceLast: ActivitySignal[];
  lastCheckInAt?: string;
}
```

Layout: "Watching for: [editable]" (top) · activity-since-last list, honest empty state (middle) · action set (bottom).

Action exits:

| Button | Exit | Side effect |
|---|---|---|
| **Still watching** | `{ kind: "check-in", continue: true }` | POST check-in `continued=true`; item stays in_queue; slot promotes next |
| **Resolved** | `{ kind: "done", outcome }` | mark done with outcome textarea (small modal) |
| **Stop watching** | `{ kind: "check-in", continue: false }` | check-in `continued=false`; mark done with `resolved_via='abandoned'` |
| **Promote to action** | `{ kind: "repathway", newPathway }` | re-pathway popover restricted to `quick_reply` / `decision_gate` |

### `<DelegateCanvas>` contract

```ts
interface DelegateProps extends CanvasBaseProps {
  delegate: { name: string; channel: "gmail" | "slack"; lastHeardAt?: string };
  activity: ActivitySignal[];
  draftNudge?: string;
}
```

Layout: who/when/last-heard (top) · activity timeline (middle) · action buttons + "Send nudge" expander with tone slider Gentle/Direct/Escalate (bottom).

Nudge is NOT a slot exit — timer keeps running. Resolved = terminal.

Urgency-based silence threshold for pre-warming a nudge:
- `urgent` → 1 day
- `high` → 3 days
- `medium` → 7 days
- `low` → 14 days

### Acceptance criteria
- [ ] Heads-down slots show pre-warmed plan immediately on activation.
- [ ] "Open in Claude Desktop" copies prompt + launches deep-link.
- [ ] Watching slots show activity-since-last with correct timestamps.
- [ ] "Still watching" creates `watch_check_ins` row with `continued=true`; slot promotes next; item stays `in_queue`.
- [ ] "Stop watching" creates check-in with `continued=false` and marks item done with `resolved_via='abandoned'`.
- [ ] Delegate canvas pre-warms a nudge only when silence ≥ urgency threshold.
- [ ] `watch_check_ins` queryable per item in chronological order.
- [ ] Migration 030 applied to local DB and CI green on push.
- [ ] Progress tracker row for Phase 3 updated from `Pending` to `Shipped` with this PR's URL, in the same commit as the code.

### End-of-PR reminder (agent MUST include verbatim)

> ✅ **Phase 3 complete.** Next steps for Sidd:
> 1. Review the diff and merge this PR when satisfied.
> 2. **Terminate this agent session** — do not continue it.
> 3. Spawn a fresh agent with the **Unified phase-runner prompt** from `SPRINT_FOCUS_REDESIGN.md` § Part 5. It will self-route to Phase 4 by reading the Progress tracker on main.

---

## Phase 4 — Meeting-prep canvas + pre-warm scheduler

### Goal
The 7th pathway lands; pre-warm becomes systematic.

### Estimated effort
~2 days.

### Migrations

**`supabase/migrations/031_sprint_prewarm.sql`** — *only if `sprint_blocks` is server-backed.* If it's purely client-side (Zustand persist to localStorage), skip the migration and add the fields to the `SprintBlock` TypeScript interface in `src/store/sprint-store.ts`. Verify before running.

```sql
ALTER TABLE public.sprint_blocks
  ADD COLUMN IF NOT EXISTS prewarm_status TEXT NULL
    CHECK (prewarm_status IN ('pending','warming','ready','skipped','failed')),
  ADD COLUMN IF NOT EXISTS prewarm_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS prewarm_completed_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS prewarm_error TEXT NULL;
```

### Files

**New:**
- `src/components/sprint/canvases/meeting-prep-canvas.tsx`
- `src/lib/sprint/prewarm-scheduler.ts`
- `src/app/api/sprint/prewarm/route.ts`
- `src/lib/sprint/meeting-match.ts`
- `src/lib/anthropic/talking-points.ts`
- `src/app/api/s2d/[itemId]/stage-meeting/route.ts`

**Edited:**
- `src/store/sprint-store.ts` — `startSprint` and `completeBlock` call `schedulePrewarm`. Add 90% timer signal.
- `src/hooks/use-enriched-context.ts` — add 2s polling while `prewarm_status === 'warming'`.
- `src/components/sprint/canvases/pathway-canvas.tsx` — wire MeetingPrepCanvas.
- **Delete** `src/components/sprint/sprint-card-workspace.tsx` — all pathways are now native; tabs fallback is unused.

### `<MeetingPrepCanvas>` contract

```ts
interface MeetingPrepProps extends CanvasBaseProps {
  candidateMeetings: CalendarEvent[];
  selectedMeetingId?: string;
  talkingPoints?: string;
}
```

Layout: meeting picker (top, "Schedule one?" CTA when no matches) · talking-points textarea (middle, drag-reorderable) · "Add to meeting agenda" button + Skip/Bench/Snooze (bottom).

Done exit: `onExit({ kind: "stage-meeting", calendarEventId, talkingPoints })`. Server inserts into calendar event description (or copies to clipboard if no API write access).

### Acceptance criteria
- [ ] All 7 pathways render a pathway canvas.
- [ ] `sprint-card-workspace.tsx` deleted from repo.
- [ ] Slot activation → pre-warm fires within 100ms (debounced 50ms).
- [ ] Decision pre-warm fires only when `block.prewarm_opt_in === true`.
- [ ] Queued slot's pre-warm completes ≥ 60% of the time before promotion (manual test: 3-item sprint, watch network tab).
- [ ] Re-pathway triggers fresh pre-warm.
- [ ] `prewarm_status` reads `'ready'` when canvas-relevant fields exist on `enriched_context`.
- [ ] Migration 031 applied if `sprint_blocks` is server-backed.
- [ ] Progress tracker row for Phase 4 updated from `Pending` to `Shipped` with this PR's URL, in the same commit as the code.

### End-of-PR reminder (agent MUST include verbatim)

> ✅ **Phase 4 complete.** Next steps for Sidd:
> 1. Review the diff and merge this PR when satisfied.
> 2. **Terminate this agent session** — do not continue it.
> 3. Spawn a fresh agent with the **Unified phase-runner prompt** from `SPRINT_FOCUS_REDESIGN.md` § Part 5. It will self-route to Phase 5 by reading the Progress tracker on main.

---

## Phase 5 — Contract card + Spawned Rail + sprint-complete rewrite

### Goal
The arc closes. Commitment → execution → recap with story.

### Estimated effort
~2 days.

### Migrations

**`supabase/migrations/032_success_statement.sql`**:

```sql
ALTER TABLE public.s2d_items
  ADD COLUMN IF NOT EXISTS success_statement TEXT NULL;

COMMENT ON COLUMN public.s2d_items.success_statement IS
  'Set at the contract card; surfaces in sprint-complete recap.';
```

### Files

**New:**
- `src/components/sprint/contract-card.tsx`
- `src/components/sprint/spawned-rail.tsx` (UI; store landed in Phase 2)
- `src/lib/anthropic/success-statement.ts`
- `src/app/api/sprint/contract/route.ts` — POST persists `success_statement` per item + `prewarm_opt_in` per block; kicks off pre-warm for slots 1–3.

**Edited:**
- `src/components/sprint/planner-schedule.tsx` — "Start sprint" routes to contract card instead of takeover.
- `src/components/sprint/sprint-complete.tsx` — full rewrite to render outcome-shaped recap.
- `src/components/sprint/sprint-active-mode-multi.tsx` — mount `<SpawnedRail>` at bottom of `FocusOverlay`.

### `<ContractCard>` contract

```ts
interface ContractCardProps {
  blocks: SprintBlock[];
  onLaunch: (opts: { successStatements: Record<string, string>; prewarmOptIn: string[] }) => void;
  onEditShape: () => void;
}
```

Layout (verbatim):
```
┌──────────────────────────────────────────────────────────────┐
│  Sprint at 2:14 PM · 3 items · 47 min total                  │
├──────────────────────────────────────────────────────────────┤
│  Sprint shape ──────────────────────────────────────         │
│    ◆ Decide       ⚡ Reply        ✎ Draft                    │
│    [12 min]       [5 min]         [30 min]                   │
│                                                                │
│  At the end of this sprint you will have:                    │
│   ◆  Decided on the Q4 brand campaign spend                  │
│   ⚡  Sent a reply to Mihir on the Q3 forecast               │
│   ✎  Sent the long response to the board on diligence pace  │
│                                                                │
│  Mashi will pre-warm the work:                               │
│   ◆  Decision brief with pre-mortem  ← extra cost, ~$0.05   │
│       [ ] Skip pre-warm                                       │
│   ⚡  Draft ready when you arrive    (free)                  │
│   ✎  Draft + voice-matched          (free)                  │
│                                                                │
│            [Edit shape]              [Start sprint →]        │
└──────────────────────────────────────────────────────────────┘
```

Pre-warming begins on contract-card mount for cheap pathways (so it's in flight while user reads).

### `<SpawnedRail>` UI

Bottom of `FocusOverlay`, above sidebar's bottom margin. 36px empty / 48px populated. Horizontally scrollable. Each chip → shadcn `HoverCard` (instant) with artifact details + "View" button.

### Sprint-complete rewrite

```ts
interface SprintCompleteProps {
  blocks: SprintBlock[];
  artifacts: SpawnedArtifact[];
  spotifyTopTrack?: { title: string; artist: string };
}
```

Renders per-item rows: pathway glyph + success_statement + outcome + spawned follow-ups. Surfaces watch check-ins as outcomes too ("checked in on MASH-1421 — Mihir vague, will look Friday").

### Acceptance criteria
- [ ] Planner-schedule's "Start sprint" routes to contract card.
- [ ] Contract card pre-fills success statements; user edits persist to `s2d_items.success_statement`.
- [ ] Decision pre-warm opt-in checkbox writes `block.prewarm_opt_in`.
- [ ] Hitting Start launches takeover with pre-warm already in flight.
- [ ] `<SpawnedRail>` populates on every spawn event without page reload.
- [ ] Sprint-complete shows success_statement ↔ outcomes, spawn chain, top Spotify track.
- [ ] Migration 032 applied; CI green.
- [ ] Progress tracker row for Phase 5 updated from `Pending` to `Shipped` with this PR's URL, in the same commit as the code.

### End-of-PR reminder (agent MUST include verbatim)

> ✅ **Phase 5 complete.** Next steps for Sidd:
> 1. Review the diff and merge this PR when satisfied.
> 2. **Terminate this agent session** — do not continue it.
> 3. Spawn a fresh agent with the **Unified phase-runner prompt** from `SPRINT_FOCUS_REDESIGN.md` § Part 5. It will self-route to Phase 6 by reading the Progress tracker on main.
>
> Phase 6 is the final phase — it deletes this redesign doc as part of its PR.

---

## Phase 6 — Polish + DELETE THIS DOC

### Goal
The takeover feels alive. Re-pathway morph, acknowledgement micro-states, ambient album tint. **Delete `SPRINT_FOCUS_REDESIGN.md` as part of this PR.**

### Estimated effort
~2 days.

### Files

**New:**
- `src/components/sprint/acknowledgement.tsx`
- `src/components/sprint/repathway-popover.tsx`
- `src/lib/sprint/canvas-morph.ts` — GSAP timeline factory.
- `src/lib/spotify/album-palette.ts` — extract dominant colors (check if already partially present in `spotify-ambient-bg.tsx`).

**Edited:**
- `src/components/sprint/canvases/_shared/canvas-shell.tsx` — `forwardRef` for morph targeting.
- `src/components/sprint/timer-ring.tsx` — ring color blends with album palette via CSS var.
- `src/components/sprint/sprint-active-mode-multi.tsx` — slot exit handler awaits acknowledgement timeline before promote.

**Deleted:**
- **`SPRINT_FOCUS_REDESIGN.md`** (this file) — `rm` it as part of the commit. Confirm in PR description that the doc has served its purpose.

### Acknowledgement micro-state

```ts
interface AcknowledgementProps {
  kind: SlotExit["kind"];
  summary: string;
  spawned?: SpawnedArtifact[];
  onComplete: () => void;
}
```

GSAP timeline:
- 0–200ms: `gsap.to(canvas, { scale: 0.97, opacity: 0.4, duration: 0.2, ease: EASE.outQuick })`.
- 100–600ms: ack content scales in from 0.9 with `EASE.back`.
- 1400–1600ms: ack fades; promote callback fires.

All wrapped in `withMotion`. Reduced-motion: skip animation, show ack for 800ms, then promote.

### Re-pathway morph

`<RepathwayPopover>` shadcn `Popover` triggered by pathway badge. Lists 6 alternatives with glyph + label + 1-line description. On click:

```ts
async function repathway(newPathway: Pathway) {
  await morphOut();
  await updateItem.mutateAsync({ id: itemId, patch: { pathway: newPathway } });
  schedulePrewarm({ block, item: { ...item, pathway: newPathway }, reason: "repathway" });
  morphIn();
}
```

### Ambient tint

`spotify-ambient-bg.tsx` updates `--sprint-card-tint` from album palette. Canvas shell composes:

```ts
const style = {
  background: `linear-gradient(var(--sprint-card-tint), var(--sprint-card-tint)), hsl(var(--pw-${pathway}) / 0.04), hsl(var(--card) / 0.55)`,
};
```

Text uses `text-foreground` only — never custom — to keep contrast guarantees.

### Acceptance criteria
- [ ] Slot exit plays 1.5s acknowledgement; next slot promotes after it resolves.
- [ ] Spawned chips show inside acknowledgement.
- [ ] Pathway badge → popover → morph; no unmount-flash.
- [ ] Spotify ambient tints card fills (perceptible but never harming text contrast).
- [ ] `prefers-reduced-motion: reduce` short-circuits all morphs.
- [ ] `pnpm audit:translucency` green; no new translucency values outside sanctioned scale.
- [ ] Progress tracker row for Phase 6 updated from `Pending` to `Shipped` with this PR's URL — **note: the tracker update lands in the same commit that deletes the doc, so the tracker exists in git history but not on main after merge.** The agent should make the tracker edit first, then `git rm` the file, both in the same commit.
- [ ] **`SPRINT_FOCUS_REDESIGN.md` deleted from repo** (verify with `git status` showing it as deleted).
- [ ] PR description explicitly confirms doc removal: "Removes SPRINT_FOCUS_REDESIGN.md — redesign complete."

### End-of-PR reminder (agent MUST include verbatim)

> ✅ **Phase 6 complete — Sprint Focus Mode redesign SHIPPED.**
>
> Next steps for Sidd:
> 1. Review the diff. Confirm `SPRINT_FOCUS_REDESIGN.md` is in the deleted-files list.
> 2. Merge this PR. The redesign is complete.
> 3. **Terminate this agent session** — there are no more phases.
> 4. Optional: capture lessons-learned into project memory (e.g., things the spec got wrong that you fixed mid-flight).
>
> Thank you for shipping the reimagined sprint focus mode.

---

# Part 5 — Operational

## Unified phase-runner prompt

Spawn a fresh agent with this exact prompt for every phase. It is identical every time. The agent self-routes by reading the Progress tracker.

```
You are implementing one phase of the Sprint Focus Mode redesign. The full spec is in SPRINT_FOCUS_REDESIGN.md at the repo root.

═══ STEP 1: ROUTE ═══

1. Read SPRINT_FOCUS_REDESIGN.md in full before doing anything else.
2. Read the Progress tracker table near the top. The next phase to implement is the FIRST row with status "Pending".
3. If all rows are "Shipped", the redesign is complete. Stop and report this — there is nothing to do.
4. Run: `gh pr list --state open --search "Sprint focus"` (or scan for any open PR touching SPRINT_FOCUS_REDESIGN.md).
   If any open PR exists for a prior phase, STOP and tell Sidd to merge it before spawning the next agent. Do not start a new phase while a prior one is in review.

═══ STEP 2: IMPLEMENT ═══

Implement the chosen phase exactly as specified in its § Phase N section of the doc. Constraints (every phase):

- All acceptance criteria for this phase MUST pass before opening the PR.
- Follow AGENTS.md doctrine: shadcn-first primitives, layout primitives, z-scale tokens (Z.*/z-*), sanctioned translucency steps only (/15 /40 /55 /60 /80 /95), motion via DUR/EASE/withMotion (respects prefers-reduced-motion).
- Run `pnpm verify`, `pnpm audit:layers`, `pnpm audit:translucency`. All must be green before opening the PR.
- If the phase has a migration: apply it locally first (`supabase db push` or paste into local DB), verify schema, then commit the migration with the code.
- If the phase requires visual baselines (Phase 1 and any phase that changes a dashboard route): run `pnpm test:visual:update` and commit the updated PNGs.
- Update the Progress tracker row for this phase from "Pending" to "Shipped" with the PR URL — IN THE SAME COMMIT as the code. (For Phase 6: edit the tracker first, then `git rm SPRINT_FOCUS_REDESIGN.md` in the same commit.)

═══ STEP 3: OPEN PR ═══

- Title format: "Phase N: <subject from tracker>"
- Body: map each acceptance criterion to where it's satisfied (file:line ref or test name).
- Do not push to a protected branch. Open a PR; do not merge it. Sidd reviews and merges.

═══ STEP 4: FINAL MESSAGE ═══

- Include the verbatim "End-of-PR reminder" block from § Phase N in your final user-facing message. This is non-negotiable.
- For Phase 6 only: explicitly confirm SPRINT_FOCUS_REDESIGN.md is in the deletion list of the PR.

═══ HARD CONSTRAINTS ═══

- Implement EXACTLY ONE phase per session — the first Pending one. Do not pre-emptively start the next phase even if there's time.
- Do NOT skip ahead to a later phase. Phases have dependencies.
- Do NOT delete SPRINT_FOCUS_REDESIGN.md unless implementing Phase 6.
- Do NOT continue past PR open in this session. Stop, output the end-of-PR reminder, and let Sidd merge before spawning the next agent.
```

### How the routing actually works

Each phase's PR commits two things together: the code, and the Progress tracker update. When the PR merges to `main`, the tracker on `main` reflects the new state. The next fresh agent reads `main`'s tracker, sees the first Pending row, and runs that phase. No explicit phase number is ever passed — the codebase IS the state.

The `gh pr list` check is the safety against running a new phase while the prior one is still under review.

## End-of-PR reminder template (already in each phase)

Every phase ends with a verbatim reminder block. The agent must include it in its final user-facing message. The reminder always:
- Names the completed phase.
- Tells Sidd to terminate the agent session.
- Notes that the next phase auto-routes from the unified prompt above (no per-phase prompt needed).
- (Phase 6 only) Confirms the doc has been deleted.

## Change ledger

| Path | Phase | Status |
|---|---|---|
| `sprint/timer-ring.tsx` | 1 | New |
| `lib/sprint/merge-sources.ts` | 1 | New |
| `sprint/canvases/pathway-canvas.tsx` | 2 | New |
| `sprint/canvases/_shared/canvas-shell.tsx` | 2 | New |
| `sprint/canvases/reply-canvas.tsx` | 2 | New |
| `sprint/canvases/decide-canvas.tsx` | 2 | New |
| `sprint/refine-sheet.tsx` | 2 | New |
| `store/refine-sheet-store.ts` | 2 | New |
| `store/spawned-rail-store.ts` | 2 | New (scaffold) |
| `api/s2d/[itemId]/decision/route.ts` | 2 | New |
| `api/s2d/[itemId]/spawn-follow-up/route.ts` | 2 | New |
| `lib/anthropic/decide-brief.ts` | 2 | New |
| `migrations/029_decision_log.sql` | 2 | New |
| `sprint/canvases/heads-down-canvas.tsx` | 3 | New |
| `sprint/canvases/watch-canvas.tsx` | 3 | New |
| `sprint/canvases/delegate-canvas.tsx` | 3 | New |
| `api/s2d/[itemId]/check-in/route.ts` | 3 | New |
| `api/s2d/[itemId]/nudge/route.ts` | 3 | New |
| `lib/sprint/activity-scan.ts` | 3 | New |
| `lib/anthropic/heads-down-plan.ts` | 3 | New |
| `hooks/use-watch-check-ins.ts` | 3 | New |
| `migrations/030_watch_check_ins.sql` | 3 | New |
| `sprint/canvases/meeting-prep-canvas.tsx` | 4 | New |
| `lib/sprint/prewarm-scheduler.ts` | 4 | New |
| `api/sprint/prewarm/route.ts` | 4 | New |
| `lib/sprint/meeting-match.ts` | 4 | New |
| `lib/anthropic/talking-points.ts` | 4 | New |
| `api/s2d/[itemId]/stage-meeting/route.ts` | 4 | New |
| `migrations/031_sprint_prewarm.sql` | 4 | Conditional |
| `sprint/sprint-card-workspace.tsx` | 4 | **Deleted** |
| `sprint/contract-card.tsx` | 5 | New |
| `sprint/spawned-rail.tsx` | 5 | New |
| `lib/anthropic/success-statement.ts` | 5 | New |
| `api/sprint/contract/route.ts` | 5 | New |
| `migrations/032_success_statement.sql` | 5 | New |
| `sprint/acknowledgement.tsx` | 6 | New |
| `sprint/repathway-popover.tsx` | 6 | New |
| `lib/sprint/canvas-morph.ts` | 6 | New |
| `lib/spotify/album-palette.ts` | 6 | New |
| `SPRINT_FOCUS_REDESIGN.md` | 6 | **Deleted** |

## Risk register

| Risk | Phase | Mitigation |
|---|---|---|
| TimerRing causes CLS or perf regressions | 1 | SVG sized via ResizeObserver, no layout-shift; benchmark with React profiler |
| Decide brief pre-warm token cost spikes | 2 | Gated behind contract-card opt-in; default off; budget surfaced |
| Watching slot completion breaks sprint-end math | 3 | Treat "Still watching" as terminal-for-sprint, item requeued; explicit unit test |
| Pre-warm fires too eagerly for queued-soon items the user benches | 4 | In-flight dedupe map; track `block.id` not `item.id` so a swap invalidates cleanly |
| Sprint-complete recap is empty for sprints with all check-ins | 5 | Recap surfaces check-ins as outcomes too |
| Acknowledgement micro-state interferes with rapid Done/Skip | 6 | 1.5s holds for Done; Skip skips the ack entirely; settings toggle for power users |

## Deferred (intentionally not in this redesign)

- **Sprint command bar (`⌘+K`)** — natural-language commands like "swap slot 2 with that thing about Q3," "extend slot 1 by 5 min." Add as Phase 7 if desired post-ship.
- **Voice profile per recipient** — `get_style` MCP tool supports this (commit 9a9ae5f); wiring into Reply canvas's tone toggle is a worth-it follow-up but lands cleaner separately.
- **Watching auto-resolve suggestions** — if activity-scan detects a strong signal ("Mihir confirmed"), suggest Resolved on slot entry. Future polish.

---

**End of doc.** Phase 6 deletes it. Do not let it outlive the project.
