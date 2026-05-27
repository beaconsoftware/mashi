# Mashi Focus Card + Agent-Driven Heads-Down — Buildout Spec

## Status & lifecycle

- **Created**: 2026-05-26
- **Owner**: Sidd
- **Purpose**: Replace the heads-down sprint canvas with a Focus card — a three-tab surface (Plan / Chat / Context) where the persistent per-item agent thread is the centerpiece. Kill the legacy `Build plan` button + handoff prompt + outcome textarea. Wire the in-app agent chat to the unified tool registry so it can pull context, take actions, and edit the item's plan.
- **This document is TEMPORARY.** The final commit of this buildout deletes it (`rm MASHI_FOCUS_CARD_BUILDOUT.md` is part of that commit). Do not let this doc outlive the project.

## Dependencies

This buildout depends on the following from `MASHI_AGENT_BUILDOUT.md`:

| Phase | Required for | Status (check before starting) |
|---|---|---|
| Phase 1 | Tool registry + cursor context + `sessionTool` wrapper | Shipped (PR #99) |
| Phase 2 | `runAgentTurn` loop, `agent_threads` + `agent_messages` schema, `<ThreadView>`, `<Composer>`, `agent-thread-store` | **Must be shipped before Phase B below** |
| Phase 3 | Ring 2 write infra (`agent_actions` audit, 30s undo strip, `recordAction`) | **Must be shipped before Phase B below** (the new `set_plan` tool is ring 2) |
| Phase 5 | Ring 3 approval card | Recommended but not strict. Without it, the agent in the Chat tab can't safely send Gmail/Slack/Calendar/Linear calls; it'll either fail outright or fire optimistically. Ship Phase 5 before promoting heads-down as the default workflow surface. |

**If Phases 2 + 3 are not yet `Shipped` in `MASHI_AGENT_BUILDOUT.md`'s Progress tracker, STOP.** Run those phases first. Do not attempt this buildout against an incomplete agent foundation.

## How to use this doc

This is a small project (one engineer, ~2 days). It runs as a single phase, not the 6-phase pattern from the agent buildout. The agent that picks this up:

1. Reads this doc in full plus the dependency checks above.
2. Confirms `MASHI_AGENT_BUILDOUT.md` § Progress tracker shows Phases 1, 2, 3 as `Shipped`.
3. Implements every acceptance criterion below.
4. Opens one PR titled "Focus card: Plan / Chat / Context replaces heads-down canvas".
5. **The same PR deletes this doc (`git rm MASHI_FOCUS_CARD_BUILDOUT.md`).** Confirm in PR description: "Removes MASHI_FOCUS_CARD_BUILDOUT.md, Focus card buildout complete."

---

# Part 1 — Problem

## What's broken today

The heads-down sprint canvas at [src/components/sprint/canvases/heads-down-canvas.tsx](src/components/sprint/canvases/heads-down-canvas.tsx) is a special-purpose surface:

- A "Build plan" button at line 180 fires a one-shot Anthropic call via `/api/s2d/[id]/heads-down/plan` → `generateHeadsDownPlan()` to produce a 3-step checklist + a handoff prompt.
- The handoff prompt is meant to be copied into Claude Desktop or Claude Code, where the actual work happens.
- A "What did you produce?" textarea captures an outcome string on Done.
- A redundant "Done" primary button duplicates the SlotCard's own Done (see two-Done-buttons bug, separately tracked).

Three problems:

1. **The Build plan call is unreliable.** Response parser doesn't tolerate all Sonnet output shapes; client surfaces JSON envelopes as raw error strings. Users report it failing silently.
2. **The handoff-to-external-tool pattern is obsolete.** Mashi now has its own agent loop (Phase 2 of the agent buildout). The conversation should happen *in* Mashi, not in a clipboard-bounce to Claude Desktop.
3. **The textarea is a poor substitute for a real progress log.** A separately tracked "Note progress" feature replaces it with `s2d_items.progress_log` + a popover.

## What we want instead

The heads-down canvas IS a three-tab surface where the user and the agent collaborate on a single item:

- **Plan** — user-owned checklist on the item. New `s2d_items.plan` JSONB column. The user writes steps, or asks the agent in Chat to draft them (the agent calls the new `set_plan` ring-2 tool, which fires the standard 30s undo strip).
- **Chat** — the persistent per-item agent thread, with full tool access via the registry. This is the SAME thread `Ask Mashi` opens elsewhere — one thread per item, multi-surface. The agent can read Gmail threads, search the board, snooze the item, draft replies, all in one conversation.
- **Context** — read-only view of `enriched_context.pulled_sources`, last decision, last watch check-in, related items via the spawn chain, source thread snippets.

The default tab is **Chat**. Conversation is the centerpiece; Plan and Context are sidecars.

## Why the Chat tab needs tool access

A heads-down item means "I need to actually do this work." The agent's job is to help the user *do* the work, not just talk about it. That means:

- **Read tools (ring 1)** fire freely in the conversation: `get_item`, `get_message_thread`, `search_board`, `search_messages`, `who_is`, `context_for_item`, etc.
- **Mashi-internal writes (ring 2)** fire with a 30s undo strip: `set_plan`, `snooze_item`, `update_item`, `set_pathway`, `complete_item`.
- **External sends (ring 3)** pause for an approval card: `send_email`, `send_slack_message`, `create_calendar_event`, `create_linear_issue`.

All three rings are already specced in `MASHI_AGENT_BUILDOUT.md` Parts 3 + Phases 3 + 5. The Focus card just *uses* the loop + the registry, not redefining either.

---

# Part 2 — Schema + new tool

## Migration

`supabase/migrations/<next>_s2d_plan.sql`. Use the next available number; check `supabase/migrations/` before assigning. Today the latest is `032_agent_threads.sql`, so this will be `033_s2d_plan.sql` unless another migration lands first. Additive + idempotent per `AGENTS.md` § Migration patterns.

```sql
ALTER TABLE public.s2d_items
  ADD COLUMN IF NOT EXISTS plan JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.s2d_items.plan IS
  'User-owned checklist for working on this item: [{ id, text, checked, created_at }]. Editable in the Focus card Plan tab. The agent can append or replace via the set_plan ring-2 tool, with the prior value captured as undo_payload. Distinct from progress_log (mid-sprint progress notes).';
```

No `CHECK` constraint on shape (JSONB validated app-side). Default `'[]'` is critical so existing rows are queryable without a NULL check.

## TypeScript types

Add to `src/types/index.ts` (or wherever `S2DItem` is declared):

```ts
export interface PlanStep {
  id: string;            // uuid or short slug
  text: string;          // <= 200 chars
  checked: boolean;
  created_at: string;    // ISO
}

// Extend S2DItem:
//   plan: PlanStep[];
```

## New ring-2 tool: `set_plan`

`src/lib/agent/tools/set_plan.ts`:

```ts
import { z } from "zod";
import type { ToolDefinition } from "@/lib/agent/types";
import type { PlanStep } from "@/types";

const args = z.object({
  item_id: z.string().uuid(),
  steps: z.array(z.string().min(1).max(200)).min(1).max(10),
  /** When true (default), replace the plan. When false, append to existing steps. */
  replace: z.boolean().default(true),
});

type Args = z.infer<typeof args>;
type Result = { plan: PlanStep[] };

export const set_plan: ToolDefinition<Args, Result> = {
  name: "set_plan",
  description:
    "Set or append checklist steps on an item's plan. Use when the user asks for a plan ('draft me steps for this', 'break this into 3 actions') or when you've decomposed work into a tracked checklist. Steps should be verb-first and <= 14 words each. Returns the updated plan.",
  ring: "write_mashi",
  args,
  handler: async (input, ctx) => {
    // 1. Read current plan from s2d_items (scoped by user_id).
    // 2. Build new plan: steps.map(text => ({ id: nanoid(), text, checked: false, created_at: new Date().toISOString() })).
    //    If replace=true, this IS the new plan. If replace=false, append to existing.
    // 3. Capture prior plan as undo_payload via recordAction({ tool_name: 'set_plan', undo_payload: { item_id, prior_plan } }).
    // 4. UPDATE s2d_items SET plan = <new> WHERE id = ? AND user_id = ctx.userId.
    // 5. Return { plan: <new> }.
  },
};
```

Register in `src/lib/agent/registry.ts` alongside the other ring-2 tools from Phase 3.

### Undo behavior

`undo_payload = { item_id, prior_plan }`. The undo route (already built in Phase 3) reads this, writes `prior_plan` back to `s2d_items.plan`, marks `undone_at`.

---

# Part 3 — Focus card UI

## Files to DELETE

- `src/components/sprint/canvases/heads-down-canvas.tsx`
- `src/app/api/s2d/[id]/heads-down/plan/route.ts`
- `src/lib/anthropic/heads-down-plan.ts`

Search the codebase for any other references to these (e.g. `enriched_context.heads_down_plan` reads) and remove them. Existing rows may have `enriched_context.heads_down_plan` populated; leave the data alone (it's JSONB, harmless), but drop the TypeScript field from `StoredEnrichedContext` interfaces.

## Files to ADD

- `src/components/sprint/canvases/focus-card.tsx` — exports `<FocusCard>` matching `CanvasBaseProps` (the heads-down canvas's interface).
- `src/components/sprint/canvases/focus-card/plan-tab.tsx` — checklist editor.
- `src/components/sprint/canvases/focus-card/chat-tab.tsx` — embeds the agent thread.
- `src/components/sprint/canvases/focus-card/context-tab.tsx` — read-only context view.

## Files to EDIT

- `src/components/sprint/canvases/pathway-canvas.tsx` — switch the `heads_down` case from `HeadsDownCanvas` to `FocusCard`. Keep `isNativePathway()` exporting `heads_down` as native.
- `src/components/sprint/canvases/_shared/canvas-shell.tsx` — when the variant is `compact` AND `primary` is undefined, hide the Refine chip too (the Chat tab inside the Focus card IS the refine surface; surfacing Refine in the footer is redundant). New `footerVariant="bare"` option, OR a `hideRefine?: boolean` prop. Choose the simpler one — recommend `hideRefine`.

## Layout

Inside CanvasShell (which keeps the identity strip header and the sticky footer):

```
┌────────────────────────────────────────────────────────────────┐
│ [Identity strip: pathway · company · ticket · title]           │  ← CanvasShell header (unchanged)
├────────────────────────────────────────────────────────────────┤
│ ┌──────┬──────┬────────┐                                       │
│ │ Plan │ Chat │ Context│                       (default: Chat) │
│ └──────┴──────┴────────┘                                       │
│                                                                │
│   ... active tab body, scrollable ...                          │
│                                                                │
├────────────────────────────────────────────────────────────────┤
│ (CanvasShell footer: no primary, no Refine in this canvas)     │  ← see canvas-shell.tsx edit above
└────────────────────────────────────────────────────────────────┘
```

Tabs via shadcn `Tabs` from `src/components/ui/tabs.tsx` (per `AGENTS.md` § Component library doctrine — shadcn-first, always).

## Plan tab UX

Empty state: `<EmptyState>` primitive from `src/components/layout/primitives.tsx`. Copy: "No plan yet. Ask the agent in Chat to draft one, or add steps below." Below the empty state copy, a single `<Input>` row with placeholder "Add a step…" + Enter to commit.

Populated state: ordered list of checklist rows. Each row contains:

- shadcn `<Checkbox>` — toggling persists via `PATCH /api/s2d/[id]` patching the `plan` field (use the existing `useUpdateS2DItem` mutation).
- Inline `<Input>` for the text — saves on blur. Empty text on blur deletes the row.
- Trash icon button (lucide `Trash2`) — confirms then deletes.
- Drag handle (lucide `GripVertical`) on hover — dnd-kit per `AGENTS.md` (the codebase already uses it on S2D board).

Below the list: same "Add a step…" input. Steps inserted via Enter get a fresh `id = crypto.randomUUID()`, `checked: false`, `created_at = new Date().toISOString()`.

When the agent fires `set_plan` while the user is on the Plan tab, the optimistic cache update from TanStack Query refreshes the list automatically. Show a brief "Agent updated the plan" toast via `sonner` (already in the stack).

## Chat tab UX

Renders the persistent per-item agent thread. Implementation:

```tsx
import { ThreadView } from "@/components/agent/thread-view";
import { Composer } from "@/components/agent/composer";

export function ChatTab({ itemId }: { itemId: string }) {
  // ThreadView + Composer are both built in Phase 2.
  // The thread is auto-loaded via getOrCreateThreadForItem(itemId) on mount.
  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 min-h-0 overflow-hidden">
        <ThreadView itemId={itemId} />
      </div>
      <div className="shrink-0 border-t border-border/40">
        <Composer itemId={itemId} />
      </div>
    </div>
  );
}
```

Behaviors inherited from Phase 2 + 3 + 5:

- First turn on re-entry: if `s2d_items.updated_at > agent_threads.last_message_at`, assistant opens with "Since we last spoke…" recap (per `MASHI_AGENT_BUILDOUT.md` Phase 2 acceptance criterion).
- Tool calls render as collapsible cards inline (Phase 2).
- Ring 2 calls show the 30s undo strip pinned to the bottom of `<ThreadView>` (Phase 3).
- Ring 3 calls show inline approval cards (Phase 5, when shipped).

The agent's system prompt (in `runAgentTurn`) already knows the cursor context. When the user is in the Focus card, `cursor.route` is `/sprint`, `cursor.focusedItemId` is the item, `cursor.activeSprint.focusedSlotItemId` matches. No special-casing needed in the prompt; the cursor context tells the agent everything.

## Context tab UX

Read-only sectioned view. Each section only renders if non-empty (no skeleton placeholders). Sections, in order:

1. **Sources** — `enriched_context.pulled_sources` as `<Surface>` cards, one per source. Each card shows `kind` icon, `label`, truncated `snippet` (3 lines), and a "Pinned" badge when `pinned`.
2. **Last decision** — most recent `decision_log` row for this item. Show `choice` (yes/yes-but/no/defer), `note`, `condition` if any, `created_at`.
3. **Last check-in** — most recent `watch_check_ins` row. Show `note`, `continue` flag, `created_at`.
4. **Related items** — spawn chain. Ancestors (items this was spawned from) at the top, descendants (items spawned from this) below. Each as a compact row: ticket id, title, pathway badge, status. Clicking opens the related item in a new detail panel (use the existing `setDetailItemId` pattern).
5. **Source thread** — when `item.source_type` is `gmail` or `slack`, render a 3-message preview (subject + last 3 senders/timestamps). NOT the full thread; the agent can pull the full thread on demand via `get_message_thread`.

All section rendering pulls from cached data the Phase 2 read tools already use. No new endpoints. If sections render slowly, use `<Suspense>` boundaries.

---

# Part 4 — Doctrine compliance

Every change must pass:

- `pnpm verify` (typecheck + lint) — green.
- `pnpm audit:layers` — green.
- `pnpm audit:translucency` — green.
- Visual baselines regenerated for any dashboard route that changes (`pnpm test:visual:update`), commit the updated PNGs.

Specific rules:

- **shadcn-first** — Tabs, Checkbox, Input, Button, Tooltip, Toast (Sonner), Sheet (if used) all from `src/components/ui/`. No hand-rolled primitives. If a primitive doesn't exist, `npx shadcn@latest add <name>`.
- **Layout primitives** — wrap surfaces in `<Surface>` from `src/components/layout/primitives.tsx`. Use `<EmptyState>` for the Plan tab's empty state. Don't reach for arbitrary opacity values.
- **Z-scale** — no `z-[N]` arbitraries. Use `Z.*` / `z-*` tokens.
- **Translucency** — sanctioned steps `/15 /40 /55 /60 /80 /95` only. Cards inside the Focus card tabs should default to `bg-card/60` (already canonical for `<Surface>`).
- **Motion** — tab transitions via shadcn defaults (Radix). If you need a custom GSAP entry on tab change, wrap in `withMotion()` from `src/lib/animation`.
- **Multi-tenant RLS** — `set_plan` handler must scope the UPDATE by `user_id = ctx.userId`. Reading the plan in the UI goes through the existing TanStack Query hooks which already scope.
- **No em-dashes** in any user-facing copy. `sanitize.ts` strips them in agent output; manual copy in component strings must also avoid them.

---

# Part 5 — Acceptance criteria

- [ ] `s2d_items.plan` column exists with `DEFAULT '[]'::jsonb` on local DB; CI green on push.
- [ ] `set_plan` tool registered in the registry; callable from the agent loop; appears under `ring: 'write_mashi'`.
- [ ] Calling `set_plan` from the chat fires the 30s undo strip; clicking Undo reverts to the prior plan; `agent_actions` row records both args and `undo_payload` correctly.
- [ ] `src/components/sprint/canvases/heads-down-canvas.tsx`, `src/app/api/s2d/[id]/heads-down/plan/route.ts`, and `src/lib/anthropic/heads-down-plan.ts` are DELETED. No references remain in the codebase.
- [ ] `pathway-canvas.tsx` routes `heads_down` to `<FocusCard>`.
- [ ] Focus card defaults to the Chat tab on mount.
- [ ] Plan tab: empty state renders correctly. Adding a step via Enter persists. Toggling a checkbox persists. Inline edit on blur persists. Drag reorder persists. Trash deletes.
- [ ] Chat tab: typing a question and Enter streams a response. Tool calls render as collapsible cards. Ring 2 calls produce undo strip. Ring 3 calls (if Phase 5 shipped) produce approval cards.
- [ ] Chat tab + agent: asking "draft me a 3-step plan for this" triggers `set_plan`; the plan appears in the Plan tab on switch without reload.
- [ ] Re-entry recap fires (per `MASHI_AGENT_BUILDOUT.md` Phase 2 criterion) — verified by editing the item via another tab, closing + reopening the Focus card, observing the "Since we last spoke" first reply.
- [ ] Context tab: shows non-empty sections, hides empty ones. Sources, last decision, last check-in, related items, source thread preview all render when present.
- [ ] CanvasShell footer in the Focus card shows neither a primary button nor a Refine chip (the SlotCard owns Done; the Chat tab IS the refine surface).
- [ ] SlotCard's Done/Skip/Bench/Snooze/Detail row remains the canonical action row for the slot (no duplication).
- [ ] Keyboard shortcuts still work: `1`/`2`/`3` for Done on slot N, `q`/`w`/`e` for Skip on slot N, `Tab`/`F` for focus cycle, `/` or `Alt+R` for Refine (now opens the Chat tab inside the Focus card if the focused slot is heads-down; otherwise opens the existing Refine sheet).
- [ ] Migration applied to local DB. `pnpm verify` green. `pnpm audit:layers` green. `pnpm audit:translucency` green.
- [ ] Visual baselines updated.
- [ ] **`MASHI_FOCUS_CARD_BUILDOUT.md` deleted from the repo** as part of this PR. Verify with `git status` showing it under deleted files.
- [ ] PR description explicitly confirms doc removal: "Removes MASHI_FOCUS_CARD_BUILDOUT.md, Focus card buildout complete."

---

# Part 6 — Risks + open questions

| Risk | Mitigation |
|---|---|
| Phase 2 / 3 not yet shipped when this lands | Hard-block in the runner prompt: check the agent buildout's Progress tracker first and refuse to start if either is `Pending`. |
| Ring 3 tools in chat fail without Phase 5's approval gate | Document in the Chat tab onboarding: "External sends require Phase 5; until then, the agent will ask you to draft manually." Soft-disable ring 3 tools in the registry when `process.env.ENABLE_RING_3 !== 'true'`. |
| Existing rows have stale `enriched_context.heads_down_plan` data | Leave it. Don't migrate-and-clear; the JSONB key is unused after this lands and costs ~nothing in storage. |
| Plan tab + agent edits race-condition on the same item | TanStack Query's optimistic update on `useUpdateS2DItem` already handles this. The agent's `set_plan` invalidates the same query key. |
| Tab state lost when the focused slot promotes a different item | Acceptable. Each item's plan + thread is independent; the tab choice (Plan/Chat/Context) resets to Chat default on item change. |

## Deferred (intentionally not in this buildout)

- **Per-tab keyboard shortcuts** (`p`/`c`/`x` to switch tabs). Add post-ship if Sidd wants.
- **Plan templates** ("New 3-step plan", "Investigation plan", etc.). The agent's `set_plan` covers this conversationally.
- **Promoting Plan/Chat/Context to non-heads-down pathways** (reply, decide, watch, delegate, meeting-prep). Out of scope here; revisit once heads-down ships and the pattern proves itself. Other pathways keep their pathway-specific canvases.

---

**End of doc.** This commit deletes it. Do not let it outlive the project.
