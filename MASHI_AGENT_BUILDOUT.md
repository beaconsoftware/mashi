# Mashi Buildout Spec

## Status & lifecycle

- **Created**: 2026-05-26
- **Owner**: Sidd
- **Purpose**: source of truth for the sequenced PRs that turn Mashi from "a board with AI passes" into "a board with a real agent, a Focus card built around that agent, and the sprint controls to live inside it". Began life as the agent buildout (Phases 1, 6); expanded in scope to absorb the sprint-controls and Focus-card buildouts as their own phases rather than maintaining parallel spec docs.
- **This document is TEMPORARY.** It exists to drive the buildout. **The final phase's PR deletes it** (`rm MASHI_AGENT_BUILDOUT.md` is part of that commit). Do not let this doc outlive the project.

## How to use this doc

1. **One unified prompt drives the whole project.** See [§ Unified phase-runner prompt](#unified-phase-runner-prompt) in Part 5. Spawn a fresh agent with that exact prompt; it self-routes to the next pending phase by reading the Progress tracker below.
2. **Fresh agent per phase** — do not continue the same agent across phases. Each agent runs exactly one phase and stops at PR open.
3. **Merge before spawning the next agent.** The agent refuses to start a new phase if a prior phase's PR is still open.
4. Edit this doc liberally as decisions evolve. Phase 2's reality will likely change Phase 4's spec — capture that here, not in chat history.
5. **The last phase deletes this doc as part of its commit.** Today that is Phase 8 (Focus card). If new phases are appended later, the deletion responsibility moves to whichever phase becomes the new last row.

## Progress tracker

The unified prompt reads this table to decide what to do. The next phase to run is the first row with status `Pending` whose dependencies (column 4) are all `Shipped`. When implementing a phase, the agent updates this row from `Pending` to `Shipped` with the PR URL **in the same commit** as the code.

| Phase | Subject | Status | Depends on | PR |
|---|---|---|---|---|
| 1 | Foundations — schema + tool registry + cursor context + sessionTool | Shipped | — | https://github.com/beaconsoftware/mashi/pull/99 |
| 2 | Read-only agent loop + "Ask Mashi" button + persistent threads | Shipped | 1 | https://github.com/beaconsoftware/mashi/pull/103 |
| 3 | Ring 2 write tools + agent_actions audit + 30s undo | Pending | 2 | — |
| 4 | Spotlight surface + orphan threads + reference resolver | Pending | 3 | — |
| 5 | Ring 3 write tools (send/calendar/Linear) + approval gate | Pending | 3 | — |
| 6 | Thread compaction + spawn-chain inheritance | Pending | 5 | — |
| 7 | Sprint controls — Add-tasks picker + End-sprint review | Pending | — | — |
| 8 | Focus card — Plan / Chat / Context replaces heads-down + DELETE THIS DOC | Pending | 3 | — |

**Status values**: `Pending` → `Shipped`.

**Routing rule**: pick the first `Pending` row whose every dependency is `Shipped`. Phase 7 has no dependencies and can ship at any time, including before Phase 2. Phase 8 needs the ring-2 infrastructure from Phase 3.

**If all rows are `Shipped`**: the buildout is complete. The Phase 8 PR should have deleted this doc; if you're reading this, that PR hasn't merged yet.

---

# Part 1 — Problem

Mashi today is a structured board (S2D) with a sprint takeover and a fan of single-shot AI passes (triage, consolidate, propagate, draft-reply, decision-brief, talking-points, success-statement). What it doesn't have: **a general agent the user can talk to that knows the data, takes actions, and remembers**.

## What's missing, grounded in code

- **No agent loop.** Every AI call in `src/lib/anthropic/*.ts` is a one-shot prompt that returns a structured payload. There's no streaming-with-tools runner that lets a single conversation read a Gmail thread, write to `s2d_items`, and send a Slack reply.
- **MCP server is read-only.** [`src/lib/mcp/handler.ts`](src/lib/mcp/handler.ts) + the 17 tools under `src/app/api/mcp/tools/` are exposed via `mashi_pat_…` PATs for Claude Desktop / Claude Code. **Zero write tools.** No `create_item`, no `complete_block`, no `send_email`. The catalog stops at "read everything".
- **No in-app surface.** The MCP server is bearer-token only — there's no session-authed sibling. The existing Refine sheet (`src/components/sprint/refine-sheet.tsx`) is the closest thing, but its scope is "chat about one item during one sprint"; the conversation evaporates when the sprint ends.
- **No persistent thread.** Every refine session writes to `enriched_context.thread` which is per-item-per-sprint state. Re-open the same item next week → the agent doesn't remember what you discussed.
- **No cursor context.** The agent has no idea what the user is looking at. "What about this one?" requires the user to spell out `MASH-1408` every time.
- **No reference resolver.** "The Mihir thing" → no candidate list, no fuzzy match.
- **No approval / undo.** Even if write tools existed, there's no UX for "the agent wants to send this email, ok?" or "you snoozed 12 items, want to undo?".

## What good would look like

The user clicks **Ask Mashi** on any item and lands in a persistent conversation titled by the ticket id (e.g. `MASH-1408 — Approve $40k Q4 brand spend`). The agent already knows what's on screen, what was last discussed, what the source threads say, who the recipient is, what the user's voice profile sounds like. They can ask read-only questions ("what's blocking this?"), trigger Mashi-internal writes ("snooze this until Monday", "decide yes with condition: budget review"), or kick off external sends ("draft a reply to Mihir saying I'll review tomorrow"). Reversible writes apply optimistically with a 30s undo strip; outbound sends pop an approval card.

The same agent is reachable from Spotlight ⌘K with no anchor — there, the agent uses `resolve_reference` to find what the user means, then attaches the conversation to that item from then on. Orphan Spotlight chats live separately until bound.

Every conversation is part of the item's enriched context. When the item next surfaces — in the detail sheet, in a sprint slot's pre-warm — the prior thread is loaded (or summarized) as context. The conversation IS the institutional memory of that item.

---

# Part 2 — Proposed solution

## IA decision

**One thread per item, addressable from three surfaces.** The agent thread is the canonical conversation about a ticket. Identified by `MASH-{ticket_number}` as the human title. Persists across sprints, route navigations, and sessions.

- **Per-item Ask Mashi** — button on every item surface (board card hover, detail sheet, sprint slot header, sprint slot footer). Opens the thread anchored to that item.
- **Sprint refine chip** — already exists; rewires to open the same persistent thread instead of the per-sprint `enriched_context.thread`.
- **Spotlight ⌘K** — opens an orphan thread; agent uses `resolve_reference` to bind to an item when one is mentioned.

**A single tool registry powers everything.** Existing MCP tools, the in-app agent, and any future automation share one catalog. Each tool is one file exporting `{ name, schema, handler }`. Two wrappers consume the registry:
- `mcpTool` (existing) — bearer-token auth, external MCP server.
- `sessionTool` (new) — Supabase session cookie auth, in-app agent.

**Three rings of writes**, surfaced with different UX:
- **Ring 1 (reads)** — agent fires freely, results streamed inline.
- **Ring 2 (Mashi-internal writes)** — agent fires optimistically; 30s undo strip in chat; full audit row.
- **Ring 3 (external writes — Gmail / Slack / Calendar / Linear)** — approval card in chat; user clicks Approve / Edit / Cancel before the call fires.

**Threads carry across item lifecycle changes.** Re-pathway, merge, spawn — system notes get inserted into the thread, not branches. The conversation is about the *thing*, not the *shape*.

## The reimagined arc

### Phase A — Invocation
User clicks Ask Mashi (or `⌘+K` and types a reference). The chat surface opens with:
- Cursor context already injected as a system message.
- Prior thread turns loaded (collapsed if long; rolling summary visible).
- Input box focused, placeholder hints at what's possible ("Ask, decide, snooze, send…").

### Phase B — Conversation
User types. Agent streams thinking, optionally calls ring-1 tools in parallel (reads are cheap and safe). Results render inline. Tool calls are collapsed-by-default detail rows in the timeline.

### Phase C — Action
User says "snooze until Monday". Agent calls `snooze_item` (ring 2). Optimistic cache update flips the badge immediately; an undo strip appears at the bottom of the chat ("Snoozed MASH-1408 until Monday · Undo"). After 30s the strip fades; the action is committed.

User says "reply saying I'll review tomorrow". Agent drafts the reply, calls `send_email` (ring 3). Instead of firing, the call surfaces an approval card in the timeline with the full body. User clicks Approve → call fires, result row replaces the card.

### Phase D — Continuation
User closes the chat. The thread is persisted. The item's detail sheet now shows "3 prior conversations · last on 2026-05-26" and inlines the thread. Next sprint that pulls this item in: the canvas pre-warm includes a 2-line summary at the top ("Last time you decided to delay; agent flagged Roshan as a stakeholder").

### Phase E — Cross-thread
User opens Spotlight, asks "what did we decide on the brand spend last week?". Agent searches threads + decision_log, surfaces MASH-1408 and quotes the decision. User can deep-link to the full thread from the answer.

---

# Part 3 — Cross-cutting contracts

These specs are referenced by multiple phases.

## Tool registry

`src/lib/agent/tools/<name>.ts` — one file per tool:

```ts
import { z } from "zod";
import type { ToolContext, ToolDefinition } from "@/lib/agent/types";

const args = z.object({
  id: z.string().uuid(),
});

type Args = z.infer<typeof args>;

export const get_item: ToolDefinition<Args, S2DItem> = {
  name: "get_item",
  description: "Fetch a single S2D item by id. Use when you have a uuid; for ticket numbers (MASH-1408) prefer search_board.",
  ring: "read",
  args,
  handler: async (input, ctx) => {
    const { data } = await ctx.supabase
      .from("s2d_items")
      .select("*")
      .eq("id", input.id)
      .eq("user_id", ctx.userId)
      .maybeSingle();
    return data;
  },
};
```

`src/lib/agent/registry.ts` collects every tool into one map. The agent loop reads it; the MCP routes import it via `mcpTool(get_item)`; the in-app handler imports it via `sessionTool(get_item)`.

## ToolContext + wrappers

```ts
// src/lib/agent/types.ts
export interface ToolContext {
  userId: string;
  supabase: ReturnType<typeof createSupabaseServiceClient>;
  /** Provenance — was this call made via PAT (mcp), session cookie
   * (in-app agent), or a server-side automation (background)? */
  origin: "mcp" | "session" | "background";
  /** The thread the call is happening inside, if any. Used by
   * write tools to write an audit row tied to a conversation. */
  threadId?: string;
}

export type ToolRing = "read" | "write_mashi" | "write_world";

export interface ToolDefinition<TArgs, TResult> {
  name: string;
  description: string;
  ring: ToolRing;
  args: z.ZodType<TArgs>;
  handler: (input: TArgs, ctx: ToolContext) => Promise<TResult>;
}
```

`sessionTool(def)` wraps a definition into a `NextRequest -> NextResponse` handler that pulls the Supabase session, scopes by `auth.uid()`, and runs the tool.

## Cursor context

`src/lib/agent/cursor-context.ts`:

```ts
export interface CursorContext {
  route: string; // "/cockpit", "/s2d", "/sprint", "/calendar"…
  focusedItemId?: string; // S2D item the user is looking at
  selectedItemIds?: string[]; // multi-select on board
  activeSprint?: {
    sprintId: string;
    focusedSlotItemId?: string;
    queueItemIds: string[];
  };
  openSheet?: "detail" | "refine" | "spotlight" | null;
  recentlyViewedItemIds?: string[]; // last 5
  now: string; // ISO timestamp at turn start
}

export function useCursorContext(): CursorContext;
```

The hook reads from existing stores (sprint-store, refine-sheet-store, route params) plus the route. Every agent message includes the snapshot as a system block.

## Thread schema (Phase 1)

```sql
CREATE TABLE public.agent_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT auth.uid()
    REFERENCES auth.users(id) ON DELETE CASCADE,
  item_id UUID NULL REFERENCES public.s2d_items(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  -- Rolling agent-written summary of older turns, refreshed when the
  -- thread crosses ~8k tokens. Injected as a system message on every
  -- new turn so the prompt stays bounded.
  summary TEXT NULL,
  last_message_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX agent_threads_one_per_item
  ON public.agent_threads(item_id) WHERE item_id IS NOT NULL;

CREATE TABLE public.agent_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT auth.uid()
    REFERENCES auth.users(id) ON DELETE CASCADE,
  thread_id UUID NOT NULL REFERENCES public.agent_threads(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system','tool')),
  content TEXT NULL,
  tool_calls JSONB NULL,
  tool_results JSONB NULL,
  cursor_context JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_agent_messages_thread ON public.agent_messages(thread_id, created_at);

ALTER TABLE public.agent_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY threads_owner ON public.agent_threads
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY messages_owner ON public.agent_messages
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
```

The `one_per_item` constraint is load-bearing: re-entries append to the same thread, never branch.

## Agent loop

`src/lib/agent/loop.ts`:

```ts
export async function runAgentTurn(opts: {
  threadId: string;
  userId: string;
  userMessage: string;
  cursor: CursorContext;
  onDelta: (delta: AgentDelta) => void; // streams to SSE
  approvalGate?: (call: ToolCall) => Promise<"approve" | "edit" | "deny">;
}): Promise<void>;
```

Behavior:
- Loads thread summary + recent N messages.
- Prepends system: "You are Mashi's agent. Today is <date>. The user is looking at <cursor>. Prior conversation summary: <summary>."
- **Re-entry deltas — "Since we last spoke":** When the thread is item-bound and `s2d_items.updated_at > agent_threads.last_message_at` (and `last_message_at IS NOT NULL`), the loop prepends an additional `role='system'` block with a structured diff of what changed on the item since the last assistant message. The diff covers: newly-attached or removed `enriched_context.pulled_sources`, status flips, pathway changes, and any `last_update_summary` entries newer than `last_message_at`. Assembled by a new read tool `get_item_changes_since(item_id, since)` registered in `src/lib/agent/tools/get_item_changes_since.ts`. System prompt extension: "If a Since-we-last-spoke block is present, open your first reply with a 1, 2 sentence summary of what changed before answering the user's question. If no block is present, do not invent one." `last_message_at` is updated by `appendMessage()` on every assistant turn so the diff window naturally narrows.
- Streams an Anthropic call via `trackedStream` (from `src/lib/anthropic/tracked.ts`) with tool definitions from the registry filtered by ring + per-thread permissions.
- For each tool call:
  - **Ring 1**: fires immediately, result back into the stream.
  - **Ring 2**: fires immediately, but the tool implementation writes an `agent_actions` audit row + emits an `undo_token`; the delta carries the token so the UI can offer Undo.
  - **Ring 3**: pauses the stream, calls `approvalGate(call)`. On `"approve"`: fires. On `"edit"`: returns the edited args to the model. On `"deny"`: returns a synthetic tool error so the model can recover.
- Loops until the model emits no more tool calls.
- Persists every turn to `agent_messages`.

## Approval card UI

Inline chat card showing the proposed call:
```
┌── Send email · gmail ─────────────────┐
│ To: mihir@…                            │
│ Subject: Re: Q3 forecast               │
│ Body: I'll review tomorrow and circle  │
│        back by EOD with the numbers.   │
│                                        │
│ [Approve]  [Edit]  [Cancel]            │
└────────────────────────────────────────┘
```

Edit opens the args in an editable form inline. Cancel returns a synthetic tool error to the model. Approve fires the actual call.

## Undo strip

After a ring-2 call commits, a strip pins to the bottom of the chat:
```
┌──────────────────────────────────────────┐
│ ✓ Snoozed MASH-1408 until 2026-06-01     │
│ [Undo] · auto-confirms in 28s            │
└──────────────────────────────────────────┘
```

`undo_token` is opaque; `POST /api/agent/undo` resolves it to a reverse-operation. Tokens expire after 30s server-side.

## Doctrine compliance (every phase)

- shadcn primitives only — no hand-rolled buttons/inputs/dialogs/popovers ([AGENTS.md](AGENTS.md) — "Component library doctrine").
- Z-scale via `Z.*` / `z-*` utility classes only.
- Translucency: sanctioned steps `/15 /40 /55 /60 /80 /95`.
- Motion via `DUR.*` + `EASE.*` + `withMotion()`.
- Every new component → `pnpm verify` green (`tsc --noEmit && eslint`), `pnpm audit:layers` green, `pnpm audit:translucency` green.

---

# Part 4 — Phase specs

Each phase below is a complete PR brief. The agent implementing it should be able to execute solely from this section + the cross-cutting contracts above.

## Phase 1 — Foundations (schema + registry + cursor context + sessionTool)

### Goal
Plumbing only. No UI changes the user sees, but every subsequent phase depends on this.

### Estimated effort
~2 days.

### Migrations

**`supabase/migrations/033_agent_threads.sql`** — additive.

```sql
CREATE TABLE IF NOT EXISTS public.agent_threads ( /* see Part 3 */ );
CREATE TABLE IF NOT EXISTS public.agent_messages ( /* see Part 3 */ );
-- Indexes + RLS policies per Part 3.
```

### Files

**New:**
- `src/lib/agent/types.ts` — `ToolContext`, `ToolDefinition`, `ToolRing`, `CursorContext`.
- `src/lib/agent/registry.ts` — collects every tool into a `TOOL_REGISTRY: Map<string, ToolDefinition>`.
- `src/lib/agent/cursor-context.ts` — `useCursorContext()` hook + serializer for the system prompt.
- `src/lib/agent/session-tool.ts` — `sessionTool(def)` wrapper.
- `src/lib/agent/tools/get_item.ts`, `search_board.ts`, `whoami.ts`, `list_today.ts`, `list_companies.ts`, `who_is.ts`, `get_style.ts`, `context_for_item.ts`, `get_message_thread.ts`, `search_messages.ts`, `get_meeting.ts`, `search_meetings.ts`, `get_calendar_event.ts`, `get_linear_issue.ts`, `search_linear.ts`, `search_everything.ts`, `run_sync.ts` — migrate each existing tool body into the registry shape.

**Edited:**
- `src/app/api/mcp/tools/*/route.ts` (17 files) — replace inline handler with `mcpTool(registry.<name>)`.
- `src/lib/mcp/handler.ts` — make `mcpTool` consume a `ToolDefinition` instead of a raw handler. Backwards compatible signature.

### Cursor context provider

Add `<CursorContextProvider>` in `src/components/app-shell.tsx` (or wherever AppShell is). Reads route, sprint-store, refine-sheet-store, route params.

### Acceptance criteria
- [ ] All 17 existing MCP tools still work end-to-end (paste a PAT into Claude Code, call `mcp__Mashi__get_item` etc — no regressions).
- [ ] `agent_threads` and `agent_messages` tables exist on local DB with the unique constraint, indexes, and RLS policies.
- [ ] `pnpm verify` green; `pnpm audit:layers` green; `pnpm audit:translucency` green.
- [ ] Migration 033 applied to local DB and CI green on push.
- [ ] Progress tracker row for Phase 1 updated from `Pending` to `Shipped` with this PR's URL, in the same commit as the code.

### End-of-PR reminder (agent MUST include verbatim in its final user-facing message)

> ✅ **Phase 1 complete.** Next steps for Sidd:
> 1. Review the diff and merge this PR when satisfied.
> 2. **Terminate this agent session** — do not continue it.
> 3. Spawn a fresh agent with the **Unified phase-runner prompt** from `MASHI_AGENT_BUILDOUT.md` § Part 5. It will self-route to Phase 2 by reading the Progress tracker on main.
>
> Continuing this session into Phase 2 carries accumulated context that should not bleed forward. Fresh agents per phase are non-negotiable per the project plan.

---

## Phase 2 — Read-only agent loop + "Ask Mashi" button + persistent threads

### Goal
The user can click "Ask Mashi" on any item and have a real conversation. Read-only first — no writes wired yet.

### Estimated effort
~3 days.

### New read tools

Add these to the registry (build on top of Phase 1):
- `get_cursor_context` — returns the serialized cursor (read by the agent on every turn).
- `get_today` — calendar events + planned-for items + active sprint state in one shot.
- `get_current_sprint` — active blocks + slots + queue + bench + paused.
- `list_needs_review` — AI-triaged inbox queue.
- `get_thread_summary(thread_id)` — agent-generated summary of the thread itself.
- `get_spawn_chain(item_id)` — ancestors + descendants via `spawned_from_item_id`.
- `get_item_changes_since(item_id, since)` — diffs an item + its `enriched_context` against a timestamp. Returns `{ status_changed?, pathway_changed?, sources_added, sources_removed, last_update_summaries }`. Called by the agent loop on thread re-open to power the "Since we last spoke" recap.

### Files

**New:**
- `src/lib/agent/loop.ts` — `runAgentTurn` per Part 3.
- `src/lib/agent/threads.ts` — `getOrCreateThreadForItem(itemId)`, `appendMessage()`, `loadThread(threadId)`.
- `src/app/api/agent/threads/[itemId]/route.ts` — `GET` returns thread + messages; `POST` creates if missing.
- `src/app/api/agent/threads/[itemId]/messages/route.ts` — `POST` streams a turn (SSE).
- `src/components/agent/ask-mashi-button.tsx` — shadcn `Button` that opens the thread sheet for an item.
- `src/components/agent/thread-sheet.tsx` — shadcn `Sheet` containing the thread UI.
- `src/components/agent/thread-view.tsx` — message list with collapsible tool turns.
- `src/components/agent/composer.tsx` — input with `/` slash for tools, Enter to send.
- `src/store/agent-thread-store.ts` — Zustand slice for the currently-open thread (open/close, draft message, streaming state).

**Edited:**
- `src/components/s2d/s2d-item-sheet.tsx` — add `<AskMashiButton itemId={item.id} />` in the header.
- `src/components/s2d/s2d-board.tsx` — show Ask Mashi on card hover.
- `src/components/sprint/canvases/_shared/canvas-shell.tsx` — Refine chip in the footer now opens the persistent thread (not the in-sprint enriched_context.thread).
- `src/components/sprint/refine-sheet.tsx` — repurpose to render `<ThreadView>` for the bound item.

### Acceptance criteria
- [ ] Clicking "Ask Mashi" on any item opens a Sheet with the persistent thread (empty for first-time items).
- [ ] Typing a question and hitting Enter streams a response within 1.5s (cold).
- [ ] The agent reads cursor context automatically — asking "what is this about" without naming the item works when looking at a detail sheet.
- [ ] Tool calls render as collapsed rows in the timeline; expanding shows args + result JSON.
- [ ] Closing and re-opening the sheet shows the prior turns persisted.
- [ ] Re-entry recap: if the item was modified between turns (`s2d_items.updated_at > agent_threads.last_message_at`), the assistant's first reply on re-open opens with a 1, 2 sentence "Since we last spoke, X changed" summary covering sources, status, pathway, and `last_update_summary` entries. First-ever-conversation threads (`last_message_at IS NULL`) skip this. Backed by the new `get_item_changes_since` read tool.
- [ ] Refine chip in a sprint canvas opens the SAME thread that "Ask Mashi" does (one thread per item).
- [ ] `pnpm verify` green; `pnpm audit:layers` green; `pnpm audit:translucency` green.
- [ ] Visual baselines updated for any dashboard route that changes.
- [ ] Progress tracker row for Phase 2 updated from `Pending` to `Shipped`.

### End-of-PR reminder

> ✅ **Phase 2 complete.** Next steps for Sidd:
> 1. Review and merge this PR.
> 2. **Terminate this agent session** — do not continue it.
> 3. Spawn a fresh agent with the **Unified phase-runner prompt** from `MASHI_AGENT_BUILDOUT.md` § Part 5. It will self-route to Phase 3.

---

## Phase 3 — Ring 2 write tools + agent_actions audit + 30s undo

### Goal
The agent can now change things in Mashi. Reversible, audited, undoable.

### Estimated effort
~3 days.

### Migrations

**`supabase/migrations/034_agent_actions.sql`** — additive.

```sql
CREATE TABLE IF NOT EXISTS public.agent_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT auth.uid()
    REFERENCES auth.users(id) ON DELETE CASCADE,
  thread_id UUID NULL REFERENCES public.agent_threads(id) ON DELETE SET NULL,
  tool_name TEXT NOT NULL,
  ring TEXT NOT NULL CHECK (ring IN ('write_mashi','write_world')),
  args JSONB NOT NULL,
  result JSONB NULL,
  ok BOOLEAN NOT NULL,
  -- Reverse-operation payload — what we'd run to undo this. Null for
  -- irreversible writes. Tokens expire 30s after created_at.
  undo_payload JSONB NULL,
  undo_expires_at TIMESTAMPTZ NULL,
  undone_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_agent_actions_thread ON public.agent_actions(thread_id, created_at DESC);
CREATE INDEX idx_agent_actions_undo
  ON public.agent_actions(undo_expires_at)
  WHERE undone_at IS NULL AND undo_payload IS NOT NULL;

ALTER TABLE public.agent_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY agent_actions_owner ON public.agent_actions
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
```

### New ring 2 tools

Items:
- `create_item(title, pathway?, priority?, company_id?, source_type?, source_thread_id?)`
- `update_item(id, patch)` — title, description, pathway, priority, status, planned_for, company_id, snoozed_until
- `complete_item(id, outcome, resolved_via?)` — sets status=done, outcome, done_at
- `snooze_item(id, until)` — status=in_queue, snoozed_until
- `set_pathway(id, pathway)` — fires `schedulePrewarmDebounced({ reason: 'repathway' })`
- `set_planned_for(id, date|null)`
- `merge_items(primary_id, duplicate_ids)`
- `spawn_follow_up(parent_id, pathway, title, queue_hours?, reason)`

Triage:
- `approve_review_item(id)` — clears `needs_review`
- `reject_review_item(id)` — soft-delete

Sprint:
- `start_sprint(item_ids, durations?, create_calendar_events?)`
- `add_to_sprint(item_id, position?)`
- `complete_block(item_id, status)` — done/skipped
- `pause_sprint`, `resume_sprint`, `exit_sprint`
- `set_success_statement(item_id, statement)`

Decisions:
- `log_decision(item_id, choice, note, condition?, defer_until?, sources_cited?)` — also spawns follow-up on yes-but

Watching:
- `record_watch_check_in(item_id, continue, note?)`
- `set_watch_target(item_id, watch_for)`

### Files

**New:**
- `src/lib/agent/tools/*.ts` — one file per tool above.
- `src/lib/agent/undo.ts` — `recordAction(opts)` + `applyUndo(token)` + per-tool reverse-op factories.
- `src/app/api/agent/undo/route.ts` — `POST { token }` resolves an undo.
- `src/components/agent/undo-strip.tsx` — pinned to the bottom of `<ThreadView>` when an undoable action is pending.

**Edited:**
- `src/lib/agent/loop.ts` — ring-2 tool calls go through `recordAction` and emit `{ kind: "undoable", token, summary }` deltas.

### Acceptance criteria
- [ ] All listed ring-2 tools are callable from the agent loop.
- [ ] Snooze / complete / update produce a 30s undo strip; clicking it reverts the change.
- [ ] `agent_actions` rows record every write with full args, result, undo_payload.
- [ ] Undo after expiry returns a clean error ("This action can no longer be undone — too much time has passed").
- [ ] Optimistic UI updates the relevant TanStack Query caches so the board reflects the change before the server round-trip.
- [ ] Migration 034 applied locally; CI green.
- [ ] `pnpm verify` green; `pnpm audit:layers` green; `pnpm audit:translucency` green.
- [ ] Progress tracker row for Phase 3 updated.

### End-of-PR reminder

> ✅ **Phase 3 complete.** Next steps for Sidd:
> 1. Review and merge this PR.
> 2. **Terminate this agent session.**
> 3. Spawn a fresh agent with the **Unified phase-runner prompt**. It will self-route to Phase 4.

---

## Phase 4 — Spotlight surface + orphan threads + reference resolver

### Goal
The agent is no longer item-anchored only. `⌘+K` opens a chat that can find what you mean.

### Estimated effort
~2 days.

### New tools

- `resolve_reference(text, max?)` — returns 0-N candidates with confidence scores. Implementation: ticket number regex match (definitive), then exact-title contains, then full-text + recency-weighted ranking, then optional vector similarity over title+description+pulled-source content. Bias toward `cursor.recentlyViewedItemIds`.
- `attach_thread_to_item(thread_id, item_id)` — promotes an orphan thread to an item-bound thread. Errors if the item already has a thread (the unique constraint catches this; the tool surfaces it as a structured error).
- `list_recent_threads(since?, limit?)` — for Spotlight history.

### Files

**New:**
- `src/components/agent/spotlight-agent.tsx` — Spotlight `⌘+K` overlay (composes shadcn `Dialog`). Opens an orphan thread by default.
- `src/components/agent/candidate-list.tsx` — when `resolve_reference` returns multiple, the agent renders this inline with click-to-bind buttons.
- `src/lib/agent/resolve.ts` — the resolver implementation (called by the `resolve_reference` tool).

**Edited:**
- `src/components/app-shell.tsx` (or wherever the existing Spotlight lives) — register `⌘+K` to open `<SpotlightAgent>`. Existing search Spotlight gets a tab inside the agent ("Search results" vs "Ask Mashi") or is replaced entirely (decide in this phase).
- `src/lib/agent/loop.ts` — system prompt extension: "If the user references an item without a ticket id, call `resolve_reference` first. If 0 candidates, ask. If 1 candidate with high confidence, proceed. If >1, render the candidate list and wait for selection."

### Thread continuity across lifecycle events (Phase 4 contract)

- **Re-pathway** ([Phase 6 of sprint-focus redesign](#)): when an item's pathway changes via `set_pathway`, insert a `role='system'` message into the thread: `"Pathway changed from <old> to <new> on <date>."`. No branch, no new thread.
- **Merge**: when `merge_items(primary, [duplicates])` fires, append the duplicates' message rows to the primary thread with a `role='system'` separator. The absorbed thread's `item_id` becomes null (orphan); the messages live under the primary.
- **Spawn**: when `spawn_follow_up(parent, …)` creates a child, the child's first thread message is `role='system'` with the parent's rolling summary: `"This item was spawned from <parent ticket id>. Prior context: <summary>."`.

### Acceptance criteria
- [ ] `⌘+K` opens the agent's Spotlight surface.
- [ ] Typing "the brand spend thing" + Enter triggers `resolve_reference`, surfaces MASH-1408 as a candidate, and on confirm attaches the thread.
- [ ] Once attached, subsequent turns in the same conversation know the binding (the thread is now item-bound).
- [ ] Ticket-id references (`MASH-1408`, `1408`) bypass the resolver and go straight to the item.
- [ ] Re-pathway / merge / spawn produce the spec'd system messages in the relevant thread(s).
- [ ] Orphan threads appear in a recent-threads list inside Spotlight.
- [ ] `pnpm verify` green; audits green.
- [ ] Progress tracker row for Phase 4 updated.

### End-of-PR reminder

> ✅ **Phase 4 complete.** Next steps for Sidd:
> 1. Review and merge this PR.
> 2. **Terminate this agent session.**
> 3. Spawn a fresh agent with the **Unified phase-runner prompt**. It will self-route to Phase 5.

---

## Phase 5 — Ring 3 write tools (send/calendar/Linear) + approval gate

### Goal
The agent can act on the outside world — gated by per-call user approval.

### Estimated effort
~3 days.

### New ring 3 tools

Gmail:
- `send_email(to, subject, body, in_reply_to?, channel='gmail')`
- `draft_email(to, subject, body, in_reply_to?)` — Gmail drafts API (no send)
- `mark_email_read(message_id)`
- `archive_email(message_id)`

Slack:
- `send_slack_message(channel, body, in_reply_to_ts?)`
- `react_with_emoji(channel, ts, emoji)`

Calendar:
- `create_calendar_event(title, start, end, attendees, description?, link_item_id?)`
- `update_calendar_event(id, patch)`
- `staged_to_meeting(item_id, calendar_event_id, talking_points)` (compound — wraps the Phase 4 stage-meeting endpoint)

Linear:
- `create_linear_issue(title, description?, team_id, project_id?, priority?)`
- `update_linear_issue(id, patch)` — state, assignee, priority, project
- `comment_on_linear_issue(id, body)`

### Approval gate

Every ring-3 tool call:
1. `loop.ts` pauses the model stream.
2. Emits an `{ kind: "approval-needed", call }` delta to the SSE channel.
3. Client renders `<ApprovalCard>` inline in the thread.
4. User clicks Approve → POST `/api/agent/threads/[id]/approvals/[callId]` with `"approve"`.
5. Loop resumes, fires the tool, streams result.

`<ApprovalCard>` supports Edit: clicking Edit replaces the card with an editable form (`<Textarea>` for body, `<Input>` for subject/to). On save, the edited args go back to the model as a synthetic tool result `{ ok: true, edited: true, edited_args: {…} }` — the model then re-issues the tool call with the edits.

Cancel returns `{ ok: false, error: "user cancelled" }` to the model so it can recover gracefully ("Got it, want me to draft a different version?").

### Per-tool approval preferences (deferred to Phase 6 polish)
Allowlist-by-recipient and "always confirm" settings live in a settings page added in Phase 6 polish if time allows; the initial Phase 5 ship is always-confirm for every ring-3 call.

### Files

**New:**
- `src/lib/agent/tools/send_email.ts`, `draft_email.ts`, `mark_email_read.ts`, `archive_email.ts`
- `src/lib/agent/tools/send_slack_message.ts`, `react_with_emoji.ts`
- `src/lib/agent/tools/create_calendar_event.ts`, `update_calendar_event.ts`, `staged_to_meeting.ts`
- `src/lib/agent/tools/create_linear_issue.ts`, `update_linear_issue.ts`, `comment_on_linear_issue.ts`
- `src/lib/agent/approval.ts` — per-call approval channel (resolves the loop's `approvalGate` callback).
- `src/app/api/agent/threads/[itemId]/approvals/[callId]/route.ts` — `POST { decision, edited_args? }`.
- `src/components/agent/approval-card.tsx`.

**Edited:**
- `src/lib/agent/loop.ts` — wire `approvalGate` to the approval channel.

### Acceptance criteria
- [ ] Agent's first ring-3 tool call in any turn pauses the stream and surfaces an approval card.
- [ ] Approve fires the call; Edit replaces with form; Cancel returns a graceful error.
- [ ] Every ring-3 call records to `agent_actions` with `ring='write_world'`.
- [ ] Ring-3 actions are NOT undoable (no undo strip) — they're explicitly approved, not optimistic.
- [ ] `send_email` integrates with existing Gmail send infra; `send_slack_message` with existing Slack send infra.
- [ ] `create_calendar_event` honors the user's primary connected calendar.
- [ ] `create_linear_issue` requires `team_id`; the agent must call `list_linear_teams` (added as a read tool here if missing) first.
- [ ] `pnpm verify` green; audits green.
- [ ] Progress tracker row for Phase 5 updated.

### End-of-PR reminder

> ✅ **Phase 5 complete.** Next steps for Sidd:
> 1. Review and merge this PR.
> 2. **Terminate this agent session.**
> 3. Spawn a fresh agent with the **Unified phase-runner prompt**. It will self-route to Phase 6.
>
> Phase 6 is the final phase — it deletes this buildout doc as part of its PR.

---

## Phase 6 — Thread compaction + spawn-chain inheritance

### Goal
The agent is alive. Polish closes the gap between "works" and "feels like memory". (Doc deletion responsibility moved to Phase 8 — the now-last phase — when Sprint controls and Focus card were folded into this spec.)

### Estimated effort
~2 days.

### Files

**New:**
- `src/lib/agent/compact.ts` — rolling summary generator. When a thread crosses ~8k tokens of message content, summarize all-but-the-last-20 turns into `agent_threads.summary` and mark those messages with `superseded_by_summary_at`. The loop loads only non-superseded messages on subsequent turns.
- `src/lib/agent/inherit.ts` — `inheritParentContext(child_id)` walks the spawn chain and inserts the parent's rolling summary as the child thread's first system message.
- `src/components/agent/thread-summary-card.tsx` — collapsed view of the rolling summary at the top of the thread sheet ("3 weeks of conversation — expand").
- `src/components/agent/approval-prefs.tsx` — settings panel for per-tool / per-recipient approval mode (if time allows; otherwise leave allowlist as Phase 7).

**Edited:**
- `src/lib/sprint/prewarm-scheduler.ts` — when a slot's item has an existing thread, inject the thread's `summary` into the canvas pre-warm payload so it surfaces in the identity strip ("Last conversation: …").
- `src/components/sprint/canvases/_shared/canvas-shell.tsx` — render the thread summary one-liner under the title when present.
- `src/lib/agent/tools/spawn_follow_up.ts` (from Phase 3) — call `inheritParentContext` on the new child thread.
- `src/lib/agent/tools/merge_items.ts` (from Phase 3) — concatenate absorbed thread's messages into the survivor with a `role='system'` separator.

### Migration

**`supabase/migrations/035_thread_compaction.sql`** — additive.

```sql
ALTER TABLE public.agent_messages
  ADD COLUMN IF NOT EXISTS superseded_by_summary_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_agent_messages_active
  ON public.agent_messages(thread_id, created_at)
  WHERE superseded_by_summary_at IS NULL;
```

### Acceptance criteria
- [ ] Threads that cross ~8k tokens trigger compaction; subsequent turns load only the summary + last 20 messages.
- [ ] Spawn-follow-up children open with a `role='system'` message inheriting the parent's summary.
- [ ] Merge concatenates absorbed thread messages chronologically into the survivor with a system separator.
- [ ] When a sprint slot loads an item with an existing thread, the canvas pre-warm includes a 1-2 line summary visible under the title.
- [ ] `pnpm audit:translucency` green; no new translucency values outside sanctioned scale.
- [ ] Progress tracker row for Phase 6 updated from `Pending` to `Shipped`.

### End-of-PR reminder

> ✅ **Phase 6 complete — Mashi Agent SHIPPED.**
>
> The agent itself is now feature-complete (Phases 1-6). Phases 7-8 (sprint controls + Focus card) wrap the agent in the surfaces that use it.
>
> Next steps for Sidd:
> 1. Review and merge this PR.
> 2. **Terminate this agent session.**
> 3. Spawn a fresh agent with the **Unified phase-runner prompt**. It will self-route to Phase 7 or 8 next (whichever is `Pending` with deps satisfied).

---

## Phase 7 — Sprint controls: Add-tasks picker + End-sprint review

### Goal
Two surgical UX additions to the active-sprint takeover. (A) Let the user pull more S2D items into the sprint without leaving the page. (B) Replace the "Exit" button with "End sprint" that routes to the SprintComplete recap surface even when blocks aren't all settled, so the user can decide per-item dispositions for everything unfinished.

### Estimated effort
~1 day. No schema migration. Independent of Phases 1-6; can ship at any time.

### Files

**New:**
- `src/components/sprint/add-tasks-sheet.tsx` — right-side shadcn `Sheet` with a search/filter picker over `useS2DItems()` rows that aren't already in `blocks`. Each row exposes "Add to bench" (always) and "Add to slot N" (when a slot is free). Composes the existing `<S2DItemCard>` for row content. Sheet stays open across multiple adds; closes on user dismiss.

**Edited:**
- `src/components/sprint/sprint-active-mode-multi.tsx` — at [the header row near lines 987-1015](src/components/sprint/sprint-active-mode-multi.tsx:987), add a "+ Add tasks" button left of Pause; replace the "Exit" button with "End sprint" (label, icon `CheckCheck`, calls `endSprint()` from the store with no `confirm()` dialog). Mount `<AddTasksSheet>` controlled by a local `addTasksOpen` state. Also neuter Escape's exit path at [lines 898-906](src/components/sprint/sprint-active-mode-multi.tsx:898) — Escape now only closes an open detail panel; it no longer ends the sprint (too easy to fire accidentally).
- `src/store/sprint-store.ts` — extend the `SprintPhase` union at [line 25](src/store/sprint-store.ts:25) with `"complete"`. Add three actions:
  - `addItemMidSprint(s2dItemId, target: "bench" | "active")` — builds a new `SprintBlock` (durationMin default 30, status `"pending"`, prewarm fields default). Appends to `blocks`. If `target === "active"` and a slot is free, calls `fillEmptySlot(activeSlotIds.length, s2dItemId)`. The existing `startedSetRef` effect handles the `in_progress` PATCH.
  - `endSprint()` — calls `tick()` to settle any in-flight timer, then `set({ phase: "complete" })`. Does NOT mutate block statuses; pending blocks stay pending.
  - `goBackToActive()` — sets `phase: "active"`. Used by the "Back to sprint" undo button in the recap.
- `src/components/sprint/sprint-global-mount.tsx` — extend the gate at [lines 46-50](src/components/sprint/sprint-global-mount.tsx:46) so SprintComplete also renders when `phase === "complete"`, in addition to the existing `phase === "active" && allSettled` path.
- `src/app/sprint/page.tsx` — mirror the same gate extension.
- `src/components/sprint/sprint-complete.tsx`:
  - Header stat strip shows `{done} done · {skipped} skipped · {untouched} not done` when `untouched > 0`.
  - `OutcomeRow` at [line 485](src/components/sprint/sprint-complete.tsx:485) already accepts `status: "pending" | "done" | "skipped"`. Pending rows render with `border-amber-500/40 bg-amber-500/15` (sanctioned `/15` + `/40` per AGENTS.md; verify against `pnpm audit:translucency`).
  - Show a one-line "Ended early with {untouched} items unfinished" message near the top when `untouched > 0` and `phase === "complete"`. Skip on the natural-completion path.
  - Add a "Back to sprint" ghost button (lucide `Undo2` icon) visible only when `phase === "complete" && !allSettled`. Clicking calls `goBackToActive()`; no data loss.

### Acceptance criteria
- [ ] "+ Add tasks" button appears in the sprint header.
- [ ] Picker Sheet opens from the right; searchable by title + ticket number; pathway and priority chip filters work.
- [ ] Items already in `blocks` (any status) do not appear in the picker. Done / dropped / backlog items do not appear.
- [ ] "Add to bench" appends the item; the Bench strip updates without page reload.
- [ ] "Add to slot N" (when a slot is free) puts the item directly into the slot and PATCHes the item to `in_progress`.
- [ ] After adding, the row disappears from the picker; the Sheet stays open.
- [ ] "End sprint" replaces "Exit" with a `CheckCheck` icon and outline variant.
- [ ] Clicking End sprint immediately routes to the SprintComplete recap (no confirm dialog) when there are pending blocks.
- [ ] Pending blocks render in the recap with amber styling and the disposition selector (Backlog / Snooze / Keep in To Do).
- [ ] Header stat strip shows `{done} done · {skipped} skipped · {N} not done` when N > 0.
- [ ] "Back to sprint" button appears for pending sprints and returns to active with no data loss.
- [ ] Escape no longer ends the sprint; only closes open detail panels.
- [ ] Auto-completion (every block done/skipped) still routes to SprintComplete (no regression of the natural completion path).
- [ ] `pnpm verify` green; `pnpm audit:layers` green; `pnpm audit:translucency` green.
- [ ] Visual baselines regenerated for /sprint.
- [ ] Progress tracker row for Phase 7 updated from `Pending` to `Shipped` with this PR's URL, in the same commit as the code.

### Doctrine notes
- shadcn-first: Sheet, Input, Button. No hand-rolls. If a primitive is missing, install via `npx shadcn@latest add <name>`.
- Z-scale: Sheet uses `z-modal` (default); paints above the FocusOverlay's `z-focus` correctly.
- Translucency: pending-row uses sanctioned `/15` + `/40`. If `/30` is needed for any treatment, swap to `/40`.
- Motion: Sheet open/close from shadcn defaults; no custom GSAP.
- No em-dashes in user-facing copy.

### Risks
- The "+ Add tasks" picker pulls the full board. For large user accounts, paginate at 50 with a "Load more" footer; search + filters keep visible set small in practice.
- `endSprint` mid-sprint feels destructive — the disposition default of "Keep in To Do" plus the "Back to sprint" undo button mitigate.

### End-of-PR reminder

> ✅ **Phase 7 complete.** Next steps for Sidd:
> 1. Review and merge this PR.
> 2. **Terminate this agent session.**
> 3. Spawn a fresh agent with the **Unified phase-runner prompt**. It will self-route to the next `Pending` phase whose dependencies are satisfied.

---

## Phase 8 — Focus card: Plan / Chat / Context replaces heads-down + DELETE THIS DOC

### Goal
Replace the heads-down sprint canvas with a three-tab Focus card (Plan / Chat / Context) where the persistent per-item agent thread is the centerpiece. Kill the unreliable Build plan button + handoff prompt + outcome textarea. Wire the in-app agent chat to the unified tool registry so it can pull context, take actions, and edit the item's plan via a new `set_plan` ring-2 tool.

### Estimated effort
~2 days.

### Dependencies
Requires Phase 2 (agent loop + `<ThreadView>` + `<Composer>`) and Phase 3 (ring-2 write infra: `agent_actions`, undo strip, `recordAction`). Phase 5 (ring-3 approval gate) is recommended but not strict — without it, ring-3 tool calls in the chat will fail; soft-disable them via `process.env.ENABLE_RING_3 !== 'true'` until Phase 5 ships.

### Migration

**`supabase/migrations/036_s2d_plan.sql`** — additive, idempotent. (Check the current `supabase/migrations/` directory before assigning the number; today the last is `032_agent_threads.sql` but Phases 3 + 6 will land migrations 034 + 035.)

```sql
ALTER TABLE public.s2d_items
  ADD COLUMN IF NOT EXISTS plan JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.s2d_items.plan IS
  'User-owned checklist for working on this item: [{ id, text, checked, created_at }]. Editable in the Focus card Plan tab. The agent can append or replace via the set_plan ring-2 tool, with the prior value captured as undo_payload.';
```

### Files

**New ring-2 tool:**
- `src/lib/agent/tools/set_plan.ts` — args `{ item_id, steps: string[1..10], replace: boolean = true }`. Handler reads current plan, builds new `PlanStep[]` (uuid + text + `checked: false` + `created_at`), captures prior plan as `undo_payload`, writes, returns the updated plan. Ring `write_mashi`. Register in `src/lib/agent/registry.ts`.

**New UI:**
- `src/components/sprint/canvases/focus-card.tsx` — exports `<FocusCard>` matching `CanvasBaseProps`. Renders inside CanvasShell with shadcn `Tabs` containing three TabsContent panels (Plan / Chat / Context). Defaults to Chat tab.
- `src/components/sprint/canvases/focus-card/plan-tab.tsx` — checklist editor. Empty state via `<EmptyState>` primitive. Populated state: ordered list with shadcn `Checkbox`, inline `Input` (save on blur), trash button, dnd-kit drag handle to reorder. "Add a step…" input at the bottom. Edits PATCH `s2d_items.plan` via `useUpdateS2DItem`.
- `src/components/sprint/canvases/focus-card/chat-tab.tsx` — embeds `<ThreadView itemId={item.id} />` and `<Composer itemId={item.id} />` from Phase 2.
- `src/components/sprint/canvases/focus-card/context-tab.tsx` — read-only sectioned view: Sources (`enriched_context.pulled_sources`), Last decision (`decision_log` head row), Last check-in (`watch_check_ins` head row), Related items (spawn chain via `spawned_from_item_id`), Source thread preview (subject + last 3 message snippets when `source_type` is `gmail` or `slack`). Each section conditionally renders only when non-empty.

**Edited:**
- `src/components/sprint/canvases/pathway-canvas.tsx` — route the `heads_down` case to `<FocusCard>` instead of `<HeadsDownCanvas>`.
- `src/components/sprint/canvases/_shared/canvas-shell.tsx` — add a `hideRefine?: boolean` prop on CanvasShell. When true and `primary` is undefined, the footer renders no chips at all (the Chat tab IS the refine surface, so the Refine chip is redundant inside the Focus card). FocusCard passes `hideRefine`.

**Deleted:**
- `src/components/sprint/canvases/heads-down-canvas.tsx`
- `src/app/api/s2d/[id]/heads-down/plan/route.ts`
- `src/lib/anthropic/heads-down-plan.ts`
- `MASHI_AGENT_BUILDOUT.md` — **this file**. `git rm` as part of the commit.

Existing `enriched_context.heads_down_plan` JSONB data on legacy rows can remain (harmless); drop the field from any TypeScript interface that still references it.

### Acceptance criteria
- [ ] `s2d_items.plan` column exists with `DEFAULT '[]'::jsonb` on local DB; CI green on push.
- [ ] `set_plan` tool registered in the registry; ring `write_mashi`; callable from the agent loop.
- [ ] Calling `set_plan` fires the 30s undo strip; clicking Undo reverts to the prior plan; `agent_actions` row records both args and `undo_payload` correctly.
- [ ] Old heads-down canvas, route, and generator are DELETED. No references remain.
- [ ] `pathway-canvas.tsx` routes `heads_down` to `<FocusCard>`.
- [ ] Focus card defaults to the Chat tab on mount.
- [ ] Plan tab: empty state renders. Add step via Enter persists. Checkbox toggle persists. Inline edit on blur persists. Drag reorder persists. Trash deletes.
- [ ] Chat tab: typing a question and Enter streams a response. Tool calls render as collapsible cards. Ring 2 calls produce undo strip. Ring 3 calls (when Phase 5 shipped) produce approval cards.
- [ ] Chat + agent: asking "draft me a 3-step plan for this" triggers `set_plan`; switching to the Plan tab shows the new steps without reload.
- [ ] Re-entry recap fires (per Phase 2 criterion): edit the item via another surface, re-open the Focus card, observe the "Since we last spoke" first reply.
- [ ] Context tab: shows non-empty sections, hides empty ones.
- [ ] CanvasShell footer in the Focus card shows neither a primary button nor a Refine chip.
- [ ] SlotCard's Done/Skip/Bench/Snooze/Detail row remains the canonical action row.
- [ ] Keyboard shortcuts unchanged: 1/2/3 for Done, q/w/e for Skip, Tab/F for focus cycle, `/` or `Alt+R` for Refine (opens the Chat tab inside the Focus card if the focused slot is heads-down; otherwise opens the existing Refine sheet).
- [ ] Migration applied locally; CI green.
- [ ] `pnpm verify` green; `pnpm audit:layers` green; `pnpm audit:translucency` green.
- [ ] Visual baselines updated.
- [ ] Progress tracker row for Phase 8 updated from `Pending` to `Shipped` — **note: the tracker update lands in the same commit that deletes this doc.**
- [ ] **`MASHI_AGENT_BUILDOUT.md` deleted from the repo** (verify with `git status` showing it as deleted).
- [ ] PR description explicitly confirms doc removal: "Removes MASHI_AGENT_BUILDOUT.md — buildout complete."

### End-of-PR reminder

> ✅ **Phase 8 complete — Mashi Buildout SHIPPED.**
>
> Next steps for Sidd:
> 1. Review the diff. Confirm `MASHI_AGENT_BUILDOUT.md` is in the deleted-files list.
> 2. Merge this PR. The buildout is complete.
> 3. **Terminate this agent session** — there are no more phases.
> 4. Optional: capture lessons-learned into project memory.

---

# Part 5 — Operational

## Unified phase-runner prompt

Spawn a fresh agent with this exact prompt for every phase. It is identical every time. The agent self-routes by reading the Progress tracker.

```
You are implementing one phase of the Mashi Agent buildout. The full spec is in MASHI_AGENT_BUILDOUT.md at the repo root.

═══ STEP 1: ROUTE ═══

1. Read AGENTS.md in full (project doctrine). Then read MASHI_AGENT_BUILDOUT.md in full.
2. Read the Progress tracker table near the top. The next phase to implement is the FIRST row with status "Pending" whose every dependency (column 4) is "Shipped". Phases with no dependencies ("—") can run any time.
3. If all rows are "Shipped", the buildout is complete. Stop and report this — there is nothing to do.
4. Run: `gh pr list --state open --search "Phase"` (or scan for any open PR touching MASHI_AGENT_BUILDOUT.md).
   If any open PR exists for a prior phase, STOP and tell Sidd to merge it before spawning the next agent. Do not start a new phase while a prior one is in review.

═══ STEP 2: IMPLEMENT ═══

Implement the chosen phase exactly as specified in its § Phase N section of the doc. Constraints (every phase):

- All acceptance criteria for this phase MUST pass before opening the PR.
- Follow AGENTS.md doctrine: shadcn-first primitives, layout primitives, z-scale tokens (Z.*/z-*), sanctioned translucency steps only (/15 /40 /55 /60 /80 /95), motion via DUR/EASE/withMotion (respects prefers-reduced-motion).
- Run `pnpm verify`, `pnpm audit:layers`, `pnpm audit:translucency`. All must be green before opening the PR.
- If the phase has a migration: apply it locally first (`supabase db push` or paste into local DB), verify schema, then commit the migration with the code.
- If the phase requires visual baselines (any phase that changes a dashboard route): run `pnpm test:visual:update` and commit the updated PNGs.
- Update the Progress tracker row for this phase from "Pending" to "Shipped" with the PR URL — IN THE SAME COMMIT as the code. (For Phase 8: edit the tracker first, then `git rm MASHI_AGENT_BUILDOUT.md` in the same commit.)

═══ STEP 3: OPEN PR ═══

- Title format: "Phase N: <subject from tracker>"
- Body: map each acceptance criterion to where it's satisfied (file:line ref or test name).
- Do not push to a protected branch. Open a PR; do not merge it. Sidd reviews and merges.

═══ STEP 4: FINAL MESSAGE ═══

- Include the verbatim "End-of-PR reminder" block from § Phase N in your final user-facing message. This is non-negotiable.
- For Phase 8 only (the last phase): explicitly confirm MASHI_AGENT_BUILDOUT.md is in the deletion list of the PR.

═══ HARD CONSTRAINTS ═══

- Implement EXACTLY ONE phase per session — the first Pending one with dependencies satisfied. Do not pre-emptively start the next phase even if there's time.
- Do NOT skip ahead to a later phase unless its dependencies are satisfied AND prior phases without those deps are also still Pending (then route by dependency order, not just sequence).
- Do NOT delete MASHI_AGENT_BUILDOUT.md unless implementing the last phase (today: Phase 8).
- Do NOT continue past PR open in this session. Stop, output the end-of-PR reminder, and let Sidd merge before spawning the next agent.
```

### How the routing actually works

Each phase's PR commits two things together: the code, and the Progress tracker update. When the PR merges to `main`, the tracker on `main` reflects the new state. The next fresh agent reads `main`'s tracker, sees the first Pending row, and runs that phase. No explicit phase number is ever passed — the codebase IS the state.

The `gh pr list` check is the safety against running a new phase while the prior one is still under review.

## Change ledger

| Path | Phase | Status |
|---|---|---|
| `lib/agent/types.ts` | 1 | New |
| `lib/agent/registry.ts` | 1 | New |
| `lib/agent/cursor-context.ts` | 1 | New |
| `lib/agent/session-tool.ts` | 1 | New |
| `lib/agent/tools/<existing 17>.ts` | 1 | New (migrated) |
| `migrations/033_agent_threads.sql` | 1 | New |
| `lib/agent/loop.ts` | 2 | New |
| `lib/agent/threads.ts` | 2 | New |
| `lib/agent/tools/get_cursor_context.ts` + 5 more reads | 2 | New |
| `api/agent/threads/[itemId]/*` | 2 | New |
| `components/agent/ask-mashi-button.tsx` + thread UI | 2 | New |
| `store/agent-thread-store.ts` | 2 | New |
| `lib/agent/undo.ts` | 3 | New |
| `lib/agent/tools/<ring 2 set>` | 3 | New |
| `migrations/034_agent_actions.sql` | 3 | New |
| `components/agent/undo-strip.tsx` | 3 | New |
| `lib/agent/resolve.ts` | 4 | New |
| `lib/agent/tools/resolve_reference.ts` + 2 more | 4 | New |
| `components/agent/spotlight-agent.tsx` | 4 | New |
| `components/agent/candidate-list.tsx` | 4 | New |
| `lib/agent/approval.ts` | 5 | New |
| `lib/agent/tools/<ring 3 set>` | 5 | New |
| `api/agent/threads/[itemId]/approvals/[callId]/route.ts` | 5 | New |
| `components/agent/approval-card.tsx` | 5 | New |
| `lib/agent/compact.ts` | 6 | New |
| `lib/agent/inherit.ts` | 6 | New |
| `migrations/035_thread_compaction.sql` | 6 | New |
| `components/sprint/add-tasks-sheet.tsx` | 7 | New |
| `store/sprint-store.ts` (extended) | 7 | Edited |
| `components/sprint/sprint-active-mode-multi.tsx` (header buttons) | 7 | Edited |
| `components/sprint/sprint-complete.tsx` (pending rows + Back-to-sprint) | 7 | Edited |
| `lib/agent/tools/set_plan.ts` | 8 | New |
| `migrations/036_s2d_plan.sql` | 8 | New |
| `components/sprint/canvases/focus-card.tsx` (+ tab files) | 8 | New |
| `components/sprint/canvases/heads-down-canvas.tsx` | 8 | **Deleted** |
| `app/api/s2d/[id]/heads-down/plan/route.ts` | 8 | **Deleted** |
| `lib/anthropic/heads-down-plan.ts` | 8 | **Deleted** |
| `MASHI_AGENT_BUILDOUT.md` | 8 | **Deleted** |

## Risk register

| Risk | Phase | Mitigation |
|---|---|---|
| Migrating 17 read tools risks breaking the external MCP server | 1 | `mcpTool` keeps the exact same response shape; smoke-test every PAT endpoint with a paste from Claude Code before opening the PR |
| Streaming SSE behind Next.js Edge runtime has quirks | 2 | Use `export const runtime = 'nodejs'` on the messages route; keep `maxDuration` set high |
| Optimistic ring-2 writes diverge from server state on failure | 3 | TanStack Query rollback on error is already wired in `useUpdateS2DItem`; reuse the pattern; `agent_actions.ok=false` lands in audit on failure |
| Reference resolver returns wrong item silently | 4 | Surface confidence scores; require ≥0.8 to auto-bind, else render candidate list and let the user pick |
| Ring-3 approval card UX feels heavy for power users | 5 | Out of scope for Phase 5; ship always-confirm; per-tool/per-recipient allowlist deferred to Phase 6 or beyond |
| Thread compaction loses information the agent later needs | 6 | Summary is in addition to, not in place of, the original messages; `superseded_by_summary_at` flag keeps the full history queryable; the loop just doesn't inject it |
| End-sprint mid-flight feels destructive | 7 | Disposition default is "Keep in To Do" (non-destructive); "Back to sprint" undo button restores `phase: active` with no data loss |
| Ring-3 tool calls in the Focus card chat fail before Phase 5 ships | 8 | Soft-disable ring-3 tools via `process.env.ENABLE_RING_3 !== 'true'` until Phase 5 lands; chat surfaces a "external sends require approval gate" hint |

## Deferred (intentionally not in this buildout)

- **Allowlist approval modes** — per-recipient, per-tool always-allow. Lands as Phase 7 if desired post-ship.
- **Ambient suggestions** — agent watches background activity and proactively surfaces "Mihir hasn't replied in 6 days, want a nudge?". Big product surface; out of scope here.
- **Background routines / cron** — daily triage, weekly recap. The unified tool registry makes this easy to add later; the cron infra is the missing piece.
- **Voice input** — talk to Mashi. Easy to add once the loop is stable.
- **Cross-user agents** — anything multi-tenant beyond owner-scoped reads. Far future.

---

**End of doc.** Phase 8 (the last phase) deletes it. Do not let it outlive the project.
