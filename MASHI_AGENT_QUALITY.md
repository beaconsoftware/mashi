# Mashi Agent Quality Upgrade

## Status & lifecycle

- **Created**: 2026-05-27
- **Owner**: Sidd
- **Purpose**: source of truth for the sequenced PRs that take Mashi's chat agent from "single-loop tool-use" to "Claude-Code-grade agentic quality". Same operational shape as the original `MASHI_AGENT_BUILDOUT.md`: progress tracker at the top, one phase per PR, fresh agent per phase, doc gets `git rm`'d in the last phase.
- **This document is TEMPORARY.** It exists to drive the upgrade. The final phase's PR deletes it.

## Why we're doing this

The agent loop in `src/lib/agent/loop.ts` works but it tool-calls on ambiguous asks instead of asking ONE focused follow-up question, ships 50+ tools on every turn, has no memory layer beyond a rolling summary, and bakes ring-3 approval logic directly into the loop instead of a layered interceptor. Research synthesis (Anthropic "Building effective agents", Claude Code architecture docs, Cline plan/act, anthropic-cookbook) points at a small set of targeted layers around the existing loop, NOT a rewrite. Single loop stays; we add ACI (agent-computer interface) polish, a clarification escape valve, plan/act mode, hooks, memory, and tool retrieval.

**Non-goals**: orchestrator-above-the-loop, LangGraph-style state machines, framework migration. Anthropic's guidance is explicit — add that complexity only when evals show the single loop failing. Mashi's evals don't show that.

## How to use this doc

1. **One unified prompt drives the whole project.** See [§ Unified phase-runner prompt](#unified-phase-runner-prompt) at the bottom. Spawn a fresh agent with that exact prompt; it self-routes to the next pending phase by reading the Progress tracker below.
2. **Fresh agent per phase** — do not continue the same agent across phases. Each agent runs exactly one phase and stops at PR open.
3. **Merge before spawning the next agent.** The agent refuses to start a new phase if a prior phase's PR is still open.
4. Edit this doc liberally as decisions evolve. Phase 3's reality will likely change Phase 4's spec — capture that here, not in chat history.
5. **The last phase deletes this doc as part of its commit.** Today that is Phase 6 (tool retrieval). If new phases are appended later, the deletion responsibility moves to whichever phase becomes the new last row.

## Progress tracker

The unified prompt reads this table to decide what to do. The next phase to run is the first row with status `Pending` whose dependencies (column 4) are all `Shipped`. When implementing a phase, the agent updates this row from `Pending` to `Shipped` with the PR URL **in the same commit** as the code.

| Phase | Subject | Status | Depends on | PR |
|---|---|---|---|---|
| 1 | `ask_followup_question` ring-1 tool + clarification directive in system prompt | Shipped | — | [#121](https://github.com/beaconsoftware/mashi/pull/121) |
| 2 | Tool registry audit: descriptions, boundaries, split mega-tools | Shipped | — | [#122](https://github.com/beaconsoftware/mashi/pull/122) |
| 3 | Plan/Act mode — ring-2/3 filtered out in plan mode, "Act" toggle in UI | Pending | 1, 2 |  — |
| 4 | PreToolUse hook layer: ring-3 approval, dedup, audit, undo as hooks | Pending | 2 | — |
| 5 | `MASHI.md` per-user memory file + injection-after-system-prompt | Pending | 4 | — |
| 6 | Tool-search retrieval over registry + DELETE THIS DOC | Pending | 2, 4 | — |

**Status values**: `Pending` → `Shipped`.

**Routing rule**: pick the first `Pending` row whose every dependency is `Shipped`. Phases 1 and 2 have no dependencies and can ship in either order. Phase 6 needs the post-audit registry from Phase 2 and the hook layer from Phase 4.

**If all rows are `Shipped`**: the upgrade is complete. The Phase 6 PR should have deleted this doc; if you're reading this, that PR hasn't merged yet.

---

# Part 1 — Problem

The Mashi chat agent shipped in the original buildout (Phases 1-8 of `MASHI_AGENT_BUILDOUT.md`) is functionally complete but lags Claude-Code-grade agentic behavior on five dimensions:

## What's wrong, grounded in code

1. **No clarification escape valve.** `src/lib/agent/loop.ts:115` system prompt says "If unsure, ask" but offers no structured mechanism. Result: Opus tool-calls on ambiguous asks (e.g., "the brand spend thing" with three candidates) instead of asking a focused follow-up. Cline solved this by making `ask_followup_question` a first-class tool with required `question` + optional `options[2-5]`; the model picks it like any other tool.

2. **Tool registry has 50+ tools shipped every turn.** `src/lib/agent/registry.ts` exposes the entire `TOOL_REGISTRY` to every agent call. Token cost grows linearly; accuracy degrades past ~30 tools because the model has to attend across more options. Anthropic's cookbook has a `tool_search_with_embeddings.ipynb` reference for retrieval over the registry.

3. **Tool descriptions are inconsistent.** Some are one sentence (`get_today`), some are three paragraphs (`spawn_follow_up`), some lack "use X instead when…" boundaries vs sibling tools. `update_item` is a mega-tool with a `patch` param that bundles 8 different write paths — research recommends splitting.

4. **Ring-3 approval logic is baked into the loop.** `src/lib/agent/loop.ts:409-484` has explicit `if (def.ring === "write_world") { createPendingApproval(); awaitApprovalDecision(); }` branches. Same for ring-2 audit + undo (line 530-573). This makes the loop hard to reason about and impossible to layer new gates onto (dedup, dry-run, per-recipient allowlists). Claude Code's hook system models this cleanly: `PreToolUse` hooks return `allow`/`deny`/`ask`.

5. **No persistent memory beyond per-thread rolling summary.** Phase 6 of the original buildout added thread compaction (`src/lib/agent/compact.ts`) which writes a summary onto the agent_threads row. But there's no user-level memory — "always reference MASH-N when possible", "Sidd prefers concise replies", "the user manages MAP Policy Partners as their primary portco" — and no per-item memory beyond the thread itself. Claude Code's `CLAUDE.md` pattern handles this by delivering memory as a user-role message after the system prompt, re-injected after compaction.

## What good looks like

After this upgrade:
- User asks "snooze the brand spend thing" with two matching items → Mashi calls `ask_followup_question` with `options: ["MASH-1408 (Q4 brand spend, decision_gate)", "MASH-1503 (brand budget review, heads_down)"]` instead of guessing.
- A turn sends ~10 tools (retrieved by relevance) plus a fixed always-on core, not 50.
- Tool descriptions follow a uniform shape: what / when to use / when NOT to use / 1-2 example inputs / what comes back.
- Plan mode is a separate UI affordance — user types, Mashi reads + asks + proposes, hits "Act" to execute writes.
- Ring-3 approval, ring-2 undo, dedup, and audit are independent hooks composed into a chain, not branches inside the loop.
- A `MASHI.md` per-user file lives in `user_profile.mashi_md`, edited from `/settings/style`, injected as a user-role message after the system prompt every turn. Survives compaction.

---

# Part 2 — Proposed solution

## High-level shape

The single agent loop stays. We add five layers around it, each independently testable and removable:

```
┌──────────────────────────────────────────────────────────────┐
│ User turn                                                    │
└────────────────┬─────────────────────────────────────────────┘
                 ▼
┌──────────────────────────────────────────────────────────────┐
│ buildSystemPrompt() — role + style + clarification directive │ ← Phase 1 (add directive)
│ MASHI.md injection (user-role message)                       │ ← Phase 5
│ Cursor context                                               │
└────────────────┬─────────────────────────────────────────────┘
                 ▼
┌──────────────────────────────────────────────────────────────┐
│ Tool retrieval: top-K from TOOL_REGISTRY + always-on core    │ ← Phase 6
│ Filter by mode (plan vs act)                                 │ ← Phase 3
└────────────────┬─────────────────────────────────────────────┘
                 ▼
┌──────────────────────────────────────────────────────────────┐
│ Agent loop (existing). Streams text + tool_use.              │
│                                                              │
│ For each tool_use block:                                     │
│   ▶ PreToolUse hooks → allow / deny / ask                   │ ← Phase 4
│     ▶ ask_followup_question handled at app layer (no tool)  │ ← Phase 1
│     ▶ ring-3 approval hook                                  │ ← Phase 4 (migrate)
│     ▶ dedup-before-create hook                              │ ← Phase 4 (migrate)
│   ▶ Run handler                                              │
│   ▶ PostToolUse hooks → audit + undo                        │ ← Phase 4 (migrate)
└──────────────────────────────────────────────────────────────┘
```

Layers can ship and merge independently. Phase 2 (registry audit) is pure cleanup; it unblocks Phase 6 by making retrieval results trustworthy.

## IA decisions

**`ask_followup_question` is a tool, not a prompt instruction.** The model picks it like any other tool. The UI renders a `<FollowUpQuestion>` card with optional option chips the user can click instead of typing. Cline's pattern, verbatim parameter shape.

**Plan/Act mode is a per-thread setting.** Stored on `agent_threads.mode` (default `act`). UI toggle in the chat header. Plan mode = registry filtered to ring 1 + `ask_followup_question` only. Switching to Act mode flushes the next turn with full ring access.

**Hooks are pure functions of `(tool_name, input, ctx) → { decision, message?, transform? }`.** Chained in declaration order. First non-`allow` decision short-circuits. Hooks live in `src/lib/agent/hooks/`; the loop iterates `HOOKS.preTool` before dispatch, `HOOKS.postTool` after.

**`MASHI.md` is plain markdown.** Free-text. User edits it. We inject the raw string as a user-role message after the system prompt. No structure imposed.

**Tool retrieval is offline-embedded + cached.** At build time we embed each tool description; at runtime we embed the user message + retrieve top-K. Always-on core (~8 tools: cursor reads, search_board, ask_followup_question, get_message_thread, plus the current ring-2/3 toggles) ships every turn.

---

# Part 3 — Cross-cutting contracts

These specs are referenced by multiple phases.

## ToolHook contract (Phase 4)

```ts
// src/lib/agent/hooks/types.ts
export type HookDecision =
  | { decision: "allow" }
  | { decision: "deny"; message: string }
  | { decision: "ask"; message: string }
  // "transform" lets a hook rewrite the tool input before dispatch
  // (used by the dedup hook to redirect a create into an update on
  // an existing matching item).
  | { decision: "transform"; input: unknown; rationale: string };

export interface PreToolUseHook {
  name: string;
  /** Only run for tools matching this predicate. */
  matches: (toolName: string, ring: ToolRing) => boolean;
  run: (opts: {
    toolName: string;
    input: unknown;
    ring: ToolRing;
    ctx: ToolContext;
  }) => Promise<HookDecision>;
}

export interface PostToolUseHook {
  name: string;
  matches: (toolName: string, ring: ToolRing) => boolean;
  run: (opts: {
    toolName: string;
    input: unknown;
    result: unknown;
    ok: boolean;
    ring: ToolRing;
    ctx: ToolContext;
  }) => Promise<void>;
}
```

Hooks are registered in `src/lib/agent/hooks/registry.ts`. Order matters; declaration order = execution order. First non-`allow` decision short-circuits.

## Plan mode contract (Phase 3)

```ts
// agent_threads.mode column: TEXT NOT NULL DEFAULT 'act' CHECK (mode IN ('plan', 'act'))

// In the loop, gate tool exposure:
const toolsForTurn = mode === "plan"
  ? TOOL_REGISTRY_LIST.filter(t => t.ring === "read" || t.name === "ask_followup_question")
  : TOOL_REGISTRY_LIST.filter(t => allowedRings.includes(t.ring));
```

The UI shows a `<ModeToggle>` in the chat header: `Plan / Act`. Toggling persists immediately via PATCH `/api/agent/threads/[itemId]/mode`. The system prompt gets an additional line when in plan mode: *"You are in PLAN mode. You can read and ask questions only. You cannot send messages, write to the board, or take any action. Help the user decide what to do; they'll switch to ACT mode to execute."*

## MASHI.md contract (Phase 5)

- Column: `user_profile.mashi_md TEXT NOT NULL DEFAULT ''`
- Edit surface: new card on `/settings/style` with textarea + "Save" button. Char limit 8000.
- Injection: read in `buildSystemPrompt` callsite, prepend a `{ role: "user", content: "# My MASHI.md\n\n<content>" }` message immediately after the system prompt and before any prior thread replay.
- Survives compaction: re-injected on every turn, so even after a 50-turn compaction the model still sees current MASHI.md.
- Caching: use `cache_control: { type: "ephemeral" }` on the MASHI.md message so token costs don't balloon.

## Tool retrieval contract (Phase 6)

- Build step: `pnpm embed-tools` (new script) reads `TOOL_REGISTRY_LIST`, embeds each description with `voyage-3-lite` or `text-embedding-3-small` (cheap, fast), writes `src/lib/agent/tools/_embeddings.json`.
- Runtime: on each turn, embed the user message, cosine-similarity vs the cached embeddings, take top 10.
- Always-on core (~8 tools): `get_cursor_context`, `get_item`, `search_board`, `whoami`, `ask_followup_question`, `get_message_thread`, `resolve_reference`, plus the current ring-2/3 toggles via mode filter.
- Total shipped per turn: ~18 tools (8 core + 10 retrieved), down from 50+.
- The retrieved set MUST include any tool that's been called earlier in the same thread (sticky retention) so multi-turn flows don't lose access mid-conversation.

---

## § Phase 1 — `ask_followup_question` ring-1 tool + clarification directive

### Goal

Give Mashi a designated escape valve for ambiguous asks. Verbatim adoption of Cline's pattern: a tool the model picks like any other when it can't proceed without a clarification. The UI renders the question + optional option chips so the user can click instead of typing.

### Estimated effort

~3 hours.

### Dependencies

None. Ships independently.

### Files

**New tool:**
- `src/lib/agent/tools/ask_followup_question.ts` — ring `read`. Args: `{ question: string (10..280), options?: string[] (2..5, each 1..120 chars) }`. Handler is a no-op that returns `{ ok: true, question, options }` — the question is surfaced to the UI via a tool-call delta, not the user-facing assistant text. Register in `src/lib/agent/registry.ts`.

**System prompt change** (`src/lib/agent/loop.ts:115` `buildSystemPrompt`):

Add this directive verbatim:

> Before any write tool, you MUST be able to name (a) the exact target entity by its ID, (b) the user's intent in one sentence, (c) the success criterion. If any is uncertain, call ask_followup_question with 2-5 specific options. Do not call any tool to find out what the user meant — ask.

Also add a `# Clarification` section to the prompt:

> If the user references an entity ambiguously (e.g., "the brand spend thing" matching multiple items), call resolve_reference first; if multiple candidates come back with confidence < 0.9, call ask_followup_question with the candidates as options. Never guess. Never run a write tool on a guess.

**New UI component:**
- `src/components/agent/follow-up-card.tsx` — renders the question text + option chips. Clicking an option:
  1. Resolves the in-flight tool_use by POSTing `/api/agent/threads/[itemId]/follow-up/[callId]` with `{ chosen: "<option text>" }`.
  2. The server appends the chosen option as the next user turn and re-runs the loop.
  3. The UI tracks the resolved follow-up so the same question can't be answered twice.
- Layout: shadcn `Card` with the question as the title, options as `<Button variant="outline" size="sm">` chips. If the user wants to free-text instead of picking, they just type in the composer — the follow-up card stays visible until either an option is clicked or a free-text turn lands.

**New API route:**
- `src/app/api/agent/threads/[itemId]/follow-up/[callId]/route.ts` — POST `{ chosen: string }`. Appends a user message with the chosen text, re-runs `runAgentTurn`. Streams deltas as SSE, same shape as `/messages`.

**`AgentDelta` extension** (`src/lib/agent/loop.ts`):

```ts
| {
    kind: "follow-up-question";
    id: string; // tool_use_id
    question: string;
    options?: string[];
  }
```

Emitted when the tool_use block for `ask_followup_question` is detected. The loop short-circuits — no further tool calls in this turn after `ask_followup_question`, since the model is waiting for the user. The loop terminates with `kind: "done"` and the follow-up card stays in the timeline.

**ThreadView render**:
- `src/components/agent/thread-view.tsx` — wire the new `follow-up-question` delta into the message timeline. Render via `<FollowUpCard>`.

**Persistence**:
- The tool_use + tool_result for `ask_followup_question` lands in `agent_messages` like any other tool call. On thread reload, the follow-up card re-renders from the persisted tool_call if its corresponding user-response turn isn't in the history yet.

### Acceptance criteria

- [ ] `ask_followup_question` registered as ring-1 tool. Args validated by zod.
- [ ] System prompt contains the verbatim "Before any write tool…" directive.
- [ ] Asking "snooze the brand spend thing" with two matching items triggers `ask_followup_question` with both as options instead of a guess. Verify by typing the ambiguous ask in the chat and observing the tool call.
- [ ] FollowUpCard renders question + option chips. Clicking an option resolves the follow-up and the agent continues with that choice as the next user turn.
- [ ] Free-text response in the composer also resolves the follow-up.
- [ ] On thread reload after a follow-up is pending, the FollowUpCard re-renders from the persisted tool call.
- [ ] `pnpm verify`, `pnpm audit:layers`, `pnpm audit:translucency`, `pnpm build` all green.
- [ ] Progress tracker row for Phase 1 updated from `Pending` to `Shipped` in the same commit as the code.

### End-of-PR reminder

> ✅ **Phase 1 complete — ask_followup_question shipped.**
>
> Next steps for Sidd:
> 1. Test the clarification flow with a real ambiguous ask ("snooze the X thing" where multiple items match).
> 2. Merge this PR.
> 3. **Spawn a fresh agent with the unified phase-runner prompt** to start Phase 2.

---

## § Phase 2 — Tool registry audit: descriptions, boundaries, split mega-tools

### Goal

Make every tool description follow a uniform shape so the model picks reliably. Split mega-tools (`update_item` with a `patch` blob, `search_everything`) into purpose-specific tools. Add "use X instead when…" cross-references between sibling tools.

### Estimated effort

~6 hours.

### Dependencies

None. Ships independently. Phase 6 depends on this (retrieval over the registry only works if descriptions are uniform).

### Audit checklist per tool

For each tool in `src/lib/agent/tools/`, the description must:

1. **Open with a one-sentence "what it does"** — no preamble, no "This tool…".
2. **State when to use it** in 1-2 sentences with at least one concrete example.
3. **State when NOT to use it** with a pointer to the sibling tool. Example: `draft_email` description ends with "Use send_email instead when the user has already approved sending."
4. **List 1-2 example inputs** as `Example: {...}` blocks. Inline in the description.
5. **State what comes back** in one sentence. Especially for tools that can return `{ok: false, error}` — say so explicitly.

### Mega-tools to split

These have to be split (research is unambiguous: separate tools beat one tool with a `mode` param):

| Current tool | Split into |
|---|---|
| `update_item(id, patch)` | `set_item_title`, `set_item_description`, `set_item_priority`, `set_item_pathway`, `set_item_company`, `set_item_planned_for`, `set_item_snoozed_until` |
| `search_everything(query)` | Keep, but document explicitly as "broad fuzzy search across all sources" and clarify when to use `search_board` vs `search_messages` vs `search_linear` instead |

The split for `update_item` is the load-bearing one. Each split tool has a tight zod schema with exactly the field being updated. `update_item` itself stays in the registry but its description gets a "Use the field-specific set_* tools instead unless you genuinely need to update multiple fields atomically" directive at the top.

### Files

- Touch every file under `src/lib/agent/tools/*.ts` to rewrite the `description` field.
- New tools: `src/lib/agent/tools/set_item_title.ts`, `set_item_description.ts`, `set_item_priority.ts`, `set_item_pathway.ts`, `set_item_company.ts`, `set_item_planned_for.ts`, `set_item_snoozed_until.ts` — register in `src/lib/agent/registry.ts`.
- Each new `set_*` tool follows the same `undo_payload` pattern as existing ring-2 tools (capture prior value, write reverse op).

### Description template

Every tool description should fit this shape (copy-paste, then fill in):

```
<One-sentence what it does, starting with a verb.>

Use when:
- <Specific scenario 1>
- <Specific scenario 2>

Do NOT use when:
- <Anti-scenario>. Use <sibling tool> instead.

Example: { ... }

Returns: { ok, ... } — <one sentence on the shape>. May return { ok: false, error } when <condition>.
```

Limit each description to ~600 chars. The Anthropic JSON-schema converter will pass these to the model.

### Acceptance criteria

- [ ] Every tool description follows the template (audit by grep + visual review of each `description: ` block).
- [ ] No tool description is under 3 sentences.
- [ ] Every ring-2/3 write tool has a "Do NOT use when" line pointing at the sibling read tool (e.g., `send_email` → "Do NOT use to draft. Use draft_email when the user is iterating on copy").
- [ ] `update_item` is split into 7 field-specific tools. The mega-tool stays but its description warns to prefer the splits.
- [ ] Each new `set_*` tool has a 30s undo via the existing `undoPayload` pattern.
- [ ] `pnpm verify`, `pnpm audit:layers`, `pnpm audit:translucency`, `pnpm build` all green.
- [ ] Smoke-test a chat turn with each of the 7 new `set_*` tools individually. The agent should pick them over `update_item` when only one field is being changed.
- [ ] Progress tracker row updated.

### End-of-PR reminder

> ✅ **Phase 2 complete — tool registry audited.**
>
> Next steps for Sidd:
> 1. Eyeball the new `set_*` tool descriptions in `src/lib/agent/tools/set_item_*.ts`.
> 2. Merge this PR.
> 3. **Spawn a fresh agent** for Phase 3 (Plan/Act mode) or Phase 4 (hooks) — either can run next.

---

## § Phase 3 — Plan/Act mode

### Goal

Gate ring-2/3 writes behind an explicit "plan" turn that can only read and ask. User clicks "Act" to execute. Cleaner than per-tool approval gates; gives a transparency win (user sees the plan before any writes).

### Estimated effort

~5 hours.

### Dependencies

Requires Phase 1 (`ask_followup_question` is the plan-mode escape valve) and Phase 2 (so plan-mode tool listing isn't 50+ entries of inconsistently-described reads).

### Migration

**`supabase/migrations/038_agent_thread_mode.sql`** (check the latest migration number before assigning):

```sql
ALTER TABLE public.agent_threads
  ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'act'
    CHECK (mode IN ('plan', 'act'));

COMMENT ON COLUMN public.agent_threads.mode IS
  'Plan/act mode per Phase 3 of the agent quality upgrade. In plan mode the agent loop filters out ring-2/3 tools, so the model can only read and ask follow-ups. User toggles via the chat header.';
```

### Files

**Loop changes** (`src/lib/agent/loop.ts`):

- `RunAgentTurnOpts.mode?: "plan" | "act"`. Default reads from the thread row.
- Filter `toolsForTurn`:
  ```ts
  const toolsForTurn = (mode === "plan")
    ? TOOL_REGISTRY_LIST.filter(t => t.ring === "read" || t.name === "ask_followup_question")
    : TOOL_REGISTRY_LIST.filter(t => allowedRings.includes(t.ring));
  ```
- Append a system-prompt line when in plan mode:
  > You are in PLAN mode. You can read sources and ask follow-up questions only. You cannot send messages, write to the board, snooze, decide, or take any action. Help the user decide what to do; they will switch to ACT mode to execute.

**Store extension** (`src/store/agent-thread-store.ts`):

- Add `modeByThread: Record<string, "plan" | "act">` so the UI knows the current thread's mode without a fetch round-trip.

**New API route**:
- `src/app/api/agent/threads/[itemId]/mode/route.ts` — PATCH `{ mode: "plan" | "act" }`. Service-role write to `agent_threads.mode`. Returns the new mode.

**UI**:
- New `<ModeToggle>` component in `src/components/agent/mode-toggle.tsx`. shadcn `Tabs` with two triggers: Plan, Act. Position in the chat header (top of `<ThreadView>`).
- `<ThreadView>` reads the current mode from the store; if undefined, fetches from `/api/agent/threads/[itemId]` (existing route returns the thread row).
- Plan mode: show a subtle banner above the composer — "Plan mode. Mashi will not write or send." Switch to Act = banner disappears, optional toast "Act mode — Mashi can now execute."
- Composer placeholder reads "Plan with Mashi…" in plan mode, "Ask, decide, snooze, send…" in act mode.

### Acceptance criteria

- [ ] Migration applies; `mode` column exists with `DEFAULT 'act'`.
- [ ] `<ModeToggle>` renders in the chat header for both the slot chat tab and the bottom-sheet.
- [ ] Switching mode persists via PATCH and updates the store.
- [ ] In plan mode, the agent loop ONLY ships ring-1 tools + `ask_followup_question`. Verify by typing "snooze MASH-1408" — model should explain it can't write and suggest switching to Act mode (or call `ask_followup_question` if intent is unclear).
- [ ] In act mode, behavior is unchanged from today.
- [ ] System prompt includes the plan-mode directive when mode === "plan".
- [ ] Existing threads default to `mode='act'` so behavior is unchanged for already-bound items.
- [ ] `pnpm verify`, `pnpm audit:layers`, `pnpm audit:translucency`, `pnpm build` all green.
- [ ] Visual baselines updated if any.
- [ ] Progress tracker row updated.

### End-of-PR reminder

> ✅ **Phase 3 complete — Plan/Act mode shipped.**
>
> Next steps for Sidd:
> 1. Try a plan-mode session on a non-trivial item ("help me decide if we should respond to MAP-321 today").
> 2. Merge this PR.
> 3. **Spawn a fresh agent** for Phase 4 (hooks layer).

---

## § Phase 4 — PreToolUse hook layer

### Goal

Refactor ring-3 approval, ring-2 audit/undo, and dedup-before-create into independent hooks composed in a chain. The loop becomes simpler; each hook is independently testable. Unlocks future gates (per-recipient allowlists, dry-run preview, rate limits) without touching the loop.

### Estimated effort

~8 hours. This is the largest refactor in the upgrade.

### Dependencies

Requires Phase 2 (so the registry is stable and hooks can match on tool names with confidence).

### Files

**New module structure**:

```
src/lib/agent/hooks/
  types.ts           — PreToolUseHook, PostToolUseHook, HookDecision types
  registry.ts        — HOOKS.preTool[] and HOOKS.postTool[] in execution order
  runner.ts          — runPreToolHooks() + runPostToolHooks() helpers
  ring3-approval.ts  — migrated from loop.ts:409-484
  ring2-audit.ts     — migrated from loop.ts:530-573 (postToolUse hook)
  dedup-create.ts    — migrated from registry.ts findSameWorkOpenItem callsite
  approval-card-bridge.ts — bridges to existing /approvals/[callId] route
```

**Loop changes** (`src/lib/agent/loop.ts`):

- Strip the ring-3-specific branching at lines 409-484.
- Strip the ring-2-specific branching at lines 530-573.
- Replace with:
  ```ts
  // Inside the tool dispatch loop:
  const pre = await runPreToolHooks({ toolName, input, ring, ctx });
  if (pre.decision === "deny") {
    toolResults.push({ tool_use_id, content: pre.message, is_error: true });
    continue;
  }
  if (pre.decision === "ask") {
    // Emit a follow-up-question delta sourced from the hook
    opts.onDelta({ kind: "follow-up-question", id: toolUseId, question: pre.message });
    return; // halt the loop, user will respond
  }
  const effectiveInput = pre.decision === "transform" ? pre.input : input;
  const result = await def.handler(effectiveInput, ctx);
  await runPostToolHooks({ toolName, input: effectiveInput, result, ok, ring, ctx });
  ```

**ring3-approval.ts** — migrate the existing approval-card logic. The hook intercepts ring-3 calls, calls `createPendingApproval`, emits `approval-needed` delta, awaits resolution via `awaitApprovalDecision`. On approve → return `{ decision: "allow" }` (or `{ decision: "transform", input: editedArgs }` if user edited). On cancel/expire → return `{ decision: "deny", message: "user cancelled" }`.

**ring2-audit.ts** — post-tool hook that calls `recordAction` with the result. Emits the `undoable` delta when undo info is present. Replaces the inline branch.

**dedup-create.ts** — pre-tool hook on `create_item` and `spawn_follow_up` that runs `findSameWorkOpenItem`. If a closed match → deny with explanation. If an open match → transform into an `update_item` call on the existing row (returns `{ decision: "transform", input: { id, patch } }` and the loop dispatches `update_item` instead).

### Acceptance criteria

- [ ] All ring-3 approval logic moved into `hooks/ring3-approval.ts`. Loop no longer has `if (def.ring === "write_world")` branches.
- [ ] All ring-2 audit + undo logic moved into `hooks/ring2-audit.ts`. Loop no longer calls `recordAction` directly.
- [ ] Dedup logic moved into `hooks/dedup-create.ts`. Existing `findSameWorkOpenItem` callsite in the loop is gone.
- [ ] All existing acceptance criteria from Phases 3 and 5 of the original buildout still hold (ring-2 undo strips appear and work; ring-3 approval cards appear and work; dedup closes duplicate creates).
- [ ] At least one new hook is registered as a smoke test: `hooks/log-tool-call.ts` (PostToolUse) that writes a debug line per tool call. Confirms the registry pattern is composable.
- [ ] Unit tests for `runPreToolHooks` and `runPostToolHooks` covering: empty chain, allow chain, deny short-circuits, ask short-circuits, transform chains into the next hook, multiple hooks in sequence.
- [ ] `pnpm verify`, `pnpm audit:layers`, `pnpm audit:translucency`, `pnpm build` all green.
- [ ] Progress tracker row updated.

### End-of-PR reminder

> ✅ **Phase 4 complete — hook layer shipped.**
>
> Next steps for Sidd:
> 1. Eyeball the new `src/lib/agent/hooks/` directory — make sure the migration didn't drop any behavior.
> 2. Smoke-test: trigger one ring-2 write (snooze an item) and one ring-3 write (draft an email) — confirm undo strip and approval card behave exactly as before.
> 3. Merge this PR.
> 4. **Spawn a fresh agent** for Phase 5 (MASHI.md memory).

---

## § Phase 5 — MASHI.md per-user memory file

### Goal

Give the user a persistent memory file the agent re-reads every turn. Survives compaction. Edited from `/settings/style`. Delivered as a user-role message after the system prompt — Anthropic's canonical pattern from Claude Code's memory system.

### Estimated effort

~4 hours.

### Dependencies

Requires Phase 4 (the hook layer is the cleanest place to potentially intercept memory writes later — e.g., a future `update_mashi_md` ring-2 tool that lets the agent itself propose memory updates).

### Migration

**`supabase/migrations/039_user_mashi_md.sql`** (number after the previous):

```sql
ALTER TABLE public.user_profile
  ADD COLUMN IF NOT EXISTS mashi_md TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN public.user_profile.mashi_md IS
  'Per-user memory file injected into every agent turn as a user-role message after the system prompt. Edited from /settings/style. Survives compaction by being re-read every turn. Max ~8000 chars enforced at the API layer.';
```

### Files

**Loop changes** (`src/lib/agent/loop.ts`):

- In `runAgentTurn`, after building the system prompt, fetch the user's `mashi_md` (via service client).
- Prepend a user-role message to the replay history:
  ```ts
  if (mashiMd && mashiMd.trim().length > 0) {
    messages.unshift({
      role: "user",
      content: [
        {
          type: "text",
          text: `# My MASHI.md\n\n${mashiMd}`,
          cache_control: { type: "ephemeral" },
        },
      ],
    });
  }
  ```
- `cache_control` ensures Anthropic caches the MASHI.md content; the cost only hits on changes.

**Compaction respect** (`src/lib/agent/compact.ts`):
- Compaction must not summarize the MASHI.md user message away — it's not part of the conversation history, it's preamble. Adjust the compaction logic to skip the leading MASHI.md message if present.

**API route**:
- `src/app/api/user/mashi-md/route.ts` — GET returns the current `mashi_md`. PUT writes a new value (8000 char limit, sanitize trailing whitespace).

**UI** (`/settings/style`):
- New card: "Mashi memory". Textarea seeded from GET, Save button calls PUT.
- Help text under the textarea: "Free-form notes about how Mashi should work with you. Examples: 'I manage three portcos — MPP, Snailworks, Beacon SW.' 'Always reference items by MASH-N.' 'I prefer concise replies; expand only if I ask.' This text is sent to Mashi at the start of every conversation."
- Save shows a toast on success.

**Onboarding seed (optional)**:
- During onboarding, after the user picks portcos + style, write a seed MASHI.md like:
  ```
  # About me
  I'm Sidd, working at Beacon Software. My current portcos: MAP Policy Partners (MPP), Snailworks, Beacon SW.

  # Preferences
  - Be concise. One paragraph max unless I ask for more.
  - Reference items by MASH-N.
  - Don't use em-dashes.
  ```
- User can edit/clear in settings.

### Acceptance criteria

- [ ] `user_profile.mashi_md` column exists with default empty string.
- [ ] `/settings/style` shows the new Mashi memory card with textarea and Save button. Save persists.
- [ ] On every agent turn, the user's `mashi_md` (if non-empty) is prepended as a user-role message with `cache_control: ephemeral`.
- [ ] Test: type a directive in MASHI.md like "Always call me Sidd, never Siddhartha." Send a chat message that's likely to use the user's name — agent uses Sidd.
- [ ] Compaction does NOT roll the MASHI.md message into the summary. Test by triggering compaction on a long thread and verifying the MASHI.md message still appears in the next turn's request.
- [ ] Empty MASHI.md (default) skips the injection entirely (no empty user message).
- [ ] 8000-char limit enforced at the API layer; PUT returns 413 with a clear error if exceeded.
- [ ] `pnpm verify`, `pnpm audit:layers`, `pnpm audit:translucency`, `pnpm build` all green.
- [ ] Progress tracker row updated.

### End-of-PR reminder

> ✅ **Phase 5 complete — MASHI.md memory shipped.**
>
> Next steps for Sidd:
> 1. Fill in your MASHI.md at `/settings/style`. Add portco names, preferences, anything Mashi should always know.
> 2. Test that a directive in MASHI.md changes agent behavior across a fresh conversation.
> 3. Merge this PR.
> 4. **Spawn a fresh agent** for the final Phase 6 (tool retrieval + doc deletion).

---

## § Phase 6 — Tool-search retrieval over registry + DELETE THIS DOC

### Goal

Stop shipping all 50+ tools on every turn. Embed each tool's description offline; at runtime, embed the user's message and retrieve the top-K most relevant tools. Combine with a fixed always-on core. Massive token + accuracy win.

**This is the last phase. The PR for this also `git rm`'s this entire doc.**

### Estimated effort

~6 hours.

### Dependencies

Requires Phase 2 (uniform descriptions → retrieval quality) and Phase 4 (hook layer → cleanly handles "what if the model picks a tool that got filtered out" via a deny+reinstate-next-turn flow if we want to add that later; not in scope for Phase 6).

### Approach

- **Offline embedding**: new script `scripts/embed-tools.ts`. Reads `TOOL_REGISTRY_LIST`, embeds each `description` with OpenAI `text-embedding-3-small` (cheap: $0.02/1M tokens, fast). Writes `src/lib/agent/tools/_embeddings.json` as `{ [toolName]: number[] }`. Committed to the repo.
- **Build step**: add `pnpm embed-tools` to `package.json`. Run manually after any registry change; CI step checks the file is up-to-date (post-PR).
- **Runtime**: new module `src/lib/agent/retrieve.ts`. Exposes `retrieveTools(userMessage: string, opts?): Promise<AnyToolDefinition[]>`. Embeds the user message, computes cosine similarity vs the cached embeddings, returns top-K (default 10). Caches the user-message embedding for the duration of the turn.
- **Always-on core**: `src/lib/agent/retrieve.ts` exports `CORE_TOOLS` — a hand-picked array of ~8 tool names that always ship.
- **Sticky retention**: if a tool was called earlier in the same thread, include it in the retrieved set even if it didn't score top-K. Prevents multi-turn flows from losing tool access mid-conversation. Implementation: track called tools in the loop state, union with retrieved set.

### Files

- `scripts/embed-tools.ts` — offline embedder.
- `src/lib/agent/tools/_embeddings.json` — generated cache, committed.
- `src/lib/agent/retrieve.ts` — runtime retriever + `CORE_TOOLS` constant.
- `src/lib/agent/loop.ts` — replace `TOOL_REGISTRY_LIST` reference with `await retrieveTools(userMessage, { mode, calledThisThread })`.
- `package.json` — `"embed-tools": "tsx scripts/embed-tools.ts"` script.
- **`MASHI_AGENT_QUALITY.md`** — **this file**. `git rm` as part of the commit.

### Acceptance criteria

- [ ] `pnpm embed-tools` runs, writes `_embeddings.json`, exits 0.
- [ ] `_embeddings.json` is committed to the repo.
- [ ] On every chat turn, `retrieveTools(message)` returns 8-18 tools (8 core + up to 10 retrieved + sticky from prior turns). Verify by logging the tool list at the top of the loop.
- [ ] A user message like "snooze MASH-1408 until next Monday" reliably retrieves `snooze_item` in the top 10.
- [ ] A user message like "what did Mihir say in the last email?" reliably retrieves `get_message_thread` + `search_messages`.
- [ ] `ask_followup_question` is in `CORE_TOOLS` so it always ships.
- [ ] Sticky retention works: trigger `snooze_item` in turn N, then in turn N+1 send a different message — `snooze_item` should still be in the toolset for N+1 because it was called recently in this thread.
- [ ] CI check (or pre-commit hook) catches a stale `_embeddings.json` when the registry has a new tool. Recommendation: a `pnpm verify` step that re-runs embeddings in dry mode and diffs.
- [ ] **`MASHI_AGENT_QUALITY.md` deleted from the repo** (verify with `git status` showing it as deleted).
- [ ] PR description explicitly confirms doc removal: "Removes MASHI_AGENT_QUALITY.md — upgrade complete."
- [ ] `pnpm verify`, `pnpm audit:layers`, `pnpm audit:translucency`, `pnpm build` all green.
- [ ] Progress tracker row for Phase 6 updated from `Pending` to `Shipped` — **note: the tracker update lands in the same commit that deletes this doc.**

### End-of-PR reminder

> ✅ **Phase 6 complete — Mashi Agent Quality Upgrade SHIPPED.**
>
> Next steps for Sidd:
> 1. Review the diff. Confirm `MASHI_AGENT_QUALITY.md` is in the deleted-files list.
> 2. Merge this PR. The upgrade is complete.
> 3. **Terminate this agent session** — there are no more phases.
> 4. Optional: write up lessons learned. Particularly notable if any phase produced an unexpected eval delta.

---

# Part 5 — Operational

## Unified phase-runner prompt

Spawn a fresh agent with this exact prompt for every phase. It is identical every time. The agent self-routes by reading the Progress tracker.

```
You are implementing one phase of the Mashi Agent Quality Upgrade. The full spec is in MASHI_AGENT_QUALITY.md at the repo root.

═══ STEP 1: ROUTE ═══

FIRST: git fetch origin main && git show origin/main:MASHI_AGENT_QUALITY.md — read the tracker from origin/main, NOT your local worktree's copy. Worktree bases can be stale by minutes or hours if other PRs landed in parallel.
Read AGENTS.md in full (project doctrine). Then read MASHI_AGENT_QUALITY.md in full (use origin/main's version if it differs from your worktree).
Read the Progress tracker table near the top. The next phase to implement is the FIRST row with status "Pending" whose every dependency (column 4) is "Shipped". Phases with no dependencies ("—") can run any time.
If all rows are "Shipped", the upgrade is complete. Stop and report this — there is nothing to do.
Run: gh pr list --state open --search "Phase" or scan for any open PR touching MASHI_AGENT_QUALITY.md. If any open PR exists for a prior phase of this upgrade, STOP and tell Sidd to merge it before spawning the next agent. Do not start a new phase while a prior one is in review.
Also cross-check the tracker against merged PRs — if a merged Phase-N PR exists but the tracker still says Pending, the tracker on your base is stale; rebase your worktree onto origin/main before doing anything else.

═══ STEP 2: IMPLEMENT ═══

Implement the chosen phase exactly as specified in its § Phase N section of the doc. Constraints (every phase):

All acceptance criteria for this phase MUST pass before opening the PR.
Follow AGENTS.md doctrine: shadcn-first primitives, layout primitives, z-scale tokens (Z./z-), sanctioned translucency steps only (/15 /40 /55 /60 /80 /95), motion via DUR/EASE/withMotion (respects prefers-reduced-motion).
Run pnpm verify, pnpm audit:layers, pnpm audit:translucency. All must be green before opening the PR.
Also run pnpm build before opening the PR. Typecheck + lint pass doesn't catch server-only imports leaking into client bundles. The Vercel build will catch it; you should too.
If the phase has a migration: apply it locally first (supabase db push or paste into local DB), verify schema, then commit the migration with the code. Note: migration file numbers in the spec may be off-by-one — use the next available number in supabase/migrations/, not the literal number in the spec.
Update the Progress tracker row for this phase from "Pending" to "Shipped" with the PR URL — IN THE SAME COMMIT as the code. (For Phase 6: edit the tracker first, then git rm MASHI_AGENT_QUALITY.md in the same commit.)

═══ STEP 3: OPEN PR ═══

Title format: "Quality Phase N: <subject from tracker>"
Body: map each acceptance criterion to where it's satisfied (file:line ref or test name).
Do not push to a protected branch. Open a PR; do not merge it. Sidd reviews and merges.

═══ STEP 4: FINAL MESSAGE ═══

Include the verbatim "End-of-PR reminder" block from § Phase N in your final user-facing message. This is non-negotiable.
For Phase 6 only (the last phase): explicitly confirm MASHI_AGENT_QUALITY.md is in the deletion list of the PR.

═══ HARD CONSTRAINTS ═══

Implement EXACTLY ONE phase per session — the first Pending one with dependencies satisfied. Do not pre-emptively start the next phase even if there's time.
Do NOT skip ahead to a later phase unless its dependencies are satisfied AND prior phases without those deps are also still Pending (then route by dependency order, not just sequence).
Do NOT delete MASHI_AGENT_QUALITY.md unless implementing the last phase (Phase 6).
Do NOT continue past PR open in this session. Stop, output the end-of-PR reminder, and let Sidd merge before spawning the next agent.
```

### How the routing actually works

Each phase's PR commits two things together: the code, and the Progress tracker update. When the PR merges to `main`, the tracker on `main` reflects the new state. The next fresh agent reads `main`'s tracker, sees the first Pending row, and runs that phase. No explicit phase number is ever passed — the codebase IS the state.

The open-PR check is the safety against running a new phase while the prior one is still under review.

## Change ledger

| Path | Phase | Status |
|---|---|---|
| `lib/agent/tools/ask_followup_question.ts` | 1 | New |
| `components/agent/follow-up-card.tsx` | 1 | New |
| `api/agent/threads/[itemId]/follow-up/[callId]/route.ts` | 1 | New |
| `lib/agent/tools/<every existing tool>.ts` | 2 | Edited (description) |
| `lib/agent/tools/set_item_*.ts` (7 new) | 2 | New |
| `migrations/038_agent_thread_mode.sql` | 3 | New |
| `components/agent/mode-toggle.tsx` | 3 | New |
| `api/agent/threads/[itemId]/mode/route.ts` | 3 | New |
| `lib/agent/hooks/*.ts` | 4 | New (directory) |
| `lib/agent/loop.ts` | 4 | Edited (refactor) |
| `migrations/039_user_mashi_md.sql` | 5 | New |
| `api/user/mashi-md/route.ts` | 5 | New |
| `scripts/embed-tools.ts` | 6 | New |
| `lib/agent/tools/_embeddings.json` | 6 | New (generated) |
| `lib/agent/retrieve.ts` | 6 | New |
| `MASHI_AGENT_QUALITY.md` | 6 | **Deleted** |

## Risk register

| Risk | Phase | Mitigation |
|---|---|---|
| `ask_followup_question` doubles up with `resolve_reference` confusion | 1 | The directive explicitly orders them: call `resolve_reference` first; only call `ask_followup_question` if resolve returns multiple low-confidence candidates |
| Splitting `update_item` breaks existing prompt patterns the model learned | 2 | Keep `update_item` in the registry; just make the field-specific tools strictly preferred via descriptions |
| Plan mode confuses users who don't read the banner | 3 | Tip-style toast on first use; placeholder text changes; banner is visible |
| Hook refactor regresses ring-2 undo or ring-3 approval | 4 | Migration is mechanical; smoke-test both flows before opening the PR; keep one assertion test per existing AC |
| MASHI.md bloats prompt cost | 5 | 8000-char cap; `cache_control: ephemeral` so cost only hits on changes |
| Stale `_embeddings.json` ships a turn without the right tool | 6 | Pre-commit / CI check that embeddings are fresh; sticky retention catches the common multi-turn case |

## Deferred (intentionally not in this upgrade)

- **Subagents.** Useful but not urgent — wait for a concrete use case (morning triage, weekly recap). Pattern documented in research notes if/when we want it.
- **Multi-step planner above the loop.** Anthropic's research is explicit: don't add until evals show the single loop failing. Add only after Phase 6 ships and we have evals.
- **Agent-initiated MASHI.md updates** (`update_mashi_md` ring-2 tool that lets the agent propose memory updates). Layer on top of Phase 5 if it ends up wanted.
- **Per-recipient allowlists for ring-3.** The hook layer from Phase 4 makes this trivial to add later.

---

**End of doc.** Phase 6 (the last phase) deletes it. Do not let it outlive the project.
