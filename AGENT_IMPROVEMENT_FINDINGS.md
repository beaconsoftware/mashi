# Mashi Agent Surface: Improvement Findings (spec input)

> Purpose: this is the detailed source-of-truth for turning the agent audit into specs,
> then sprints. Each finding is written as a self-contained brief. It is deliberately
> long. A spec author should be able to read one brief and produce a spec without
> re-deriving the problem.
>
> Scope: the *agent* surface only (the ⌘K "Mashi" Spotlight, item-bound threads, the
> sprint Focus-card chat, the approval flow, the composer). Not the cockpit/board/calendar
> product chrome except where it touches the agent.
>
> Weighting: Mashi is an executive-function chief-of-staff agent, not a coding agent.
> Value is judged by that job. Image/file input, approval clarity, trust/citations,
> connecting third-party data, and not silently leaking cost or corrupting threads
> matter more than IDE-style features.
>
> Evidence basis: every claim below is grounded in either a live walk of the production
> app (mashi-beacon-sw.vercel.app, signed in) or a file:line read of the worktree
> `keen-brattain-d4418d`. Where the original carried audit and the code disagreed, the
> code wins, and the correction is noted.

---

## North star: the chat is a workspace, not a transcript

Today the agent surface is a transcript: linear messages, read-only collapsed tool cards,
a transient approval modal, dead components. The next-generation target is a *workspace*
where the conversation produces living, manipulable objects (interactive tool results,
editable artifacts, live plans) that the user operates and dispatches, where the agent has
presence in-turn (live narration, expressive thinking, smooth cadence) and continuity
across sessions (proactive briefs, "while you were away"). This is Epic L.

Direction set with Sidd:
- **Phased.** Live, actionable components first (near-term aliveness, on top of the polish
  and smoothness epics), then a native artifact canvas (the bigger bet).
- **Native artifact runtime.** Build the artifact runtime native to the agent surface, not
  on the Skills/Cowork layer. Skills generators (docx/pptx/xlsx/pdf) are reused as export
  targets, not as the in-chat runtime.

Hard precondition: everything in Epic L sits on Epic A. A generative, action-taking,
artifact-producing canvas on a loop you cannot cancel, bound, track, or trust to serialize
is built on sand. Foundation first, then experience.

## Execution protocol (the loop)

This doc is the single source of truth for the agent buildout. Workflow: Sidd pastes the
same prompt each time, a fresh agent session does exactly one **batch** and opens one PR,
Sidd reviews and merges, repeat until the Progress ledger is all merged. The agent holds no
memory between runs; it reconstructs all state from this ledger plus the open/merged PRs.

The ledger was collapsed from one-PR-per-item into ~6 thematic batches (Sidd's call) so
review is a handful of PRs, not ~50. A **batch** is one PR that lands every brief it
`covers` together; the genuinely XL items (subagents, scheduled runs, the artifact
workspace) stay as their own PRs because they cannot be one clean diff.

### The repeatable continuation prompt (paste verbatim each run)

This is a continuation prompt for a long-running, multi-PR effort. Each run is a fresh
session with no memory of prior runs; all state lives in this doc's ledger (on `main`) plus
the open/merged PRs. Paste it as-is every time; it advances exactly one PR per run until the
ledger is fully merged.

> You are resuming the Mashi agent buildout, a long-running multi-PR effort tracked entirely
> in `AGENT_IMPROVEMENT_FINDINGS.md`. You have no memory of previous runs. Reconstruct all
> state from that doc's Progress ledger (on `main`) plus the open and merged PRs
> (`gh pr list`, `gh pr view`). Then follow the Execution protocol in that doc: sync the
> ledger against open/merged PRs, pick the single next eligible batch, implement every brief
> it covers on a fresh `claude/agent-<id>` branch, run `pnpm verify` (and
> `pnpm test:visual:update` for UI, committing the baselines), open the PR in our
> convention, update the ledger row to IN REVIEW with the PR number, and stop. If nothing is
> eligible because a dependency is still in review, tell me exactly which PR to merge and
> stop. If every item is merged, tell me the buildout is complete. Never merge or push to
> `main` yourself.

### What the agent does each run (precise)

1. Read this doc (the Progress ledger + every brief the target batch covers) and `AGENTS.md`.
2. **Sync.** For every ledger row marked `IN REVIEW (#N)`, run
   `gh pr view N --json state,mergedAt`; if merged, set it `MERGED (#N)` and tick the box.
   This reconciliation rides inside the PR you are about to open.
3. **Eligibility.** A batch is ELIGIBLE iff: status is `TODO`, it is not already in an open
   PR, and every batch in its `deps` is `MERGED`. (deps internal to a batch are satisfied by
   landing them in the same PR.)
4. **If no eligible batch:** if batches remain but are blocked on `IN REVIEW` deps, report
   exactly which open PR(s) to merge and STOP. If everything is `MERGED`, report "buildout
   complete" and STOP.
5. Pick the eligible batch with the **lowest Order number**.
6. Branch `claude/agent-<id>-<slug>` off the latest `main` (`<id>` is the batch id, e.g. `p1`).
7. **Implement that batch** (every brief it covers), per their briefs. Honor `AGENTS.md`:
   sanctioned tokens and primitives, the motion/liveness invariant (#6) and `withMotion`,
   additive + idempotent migrations, multi-tenancy owner-only RLS, the em-dash ban. If the
   batch is too large for one clean PR (P5 and the XL items especially), split it: add
   sub-rows (e.g. `P5.a`, `P5.b`) to the ledger with their own `covers` slices and deps, do
   the first sub-row this run; the batch is `MERGED` only when every sub-row is.
8. **Verify.** Run `pnpm verify`. For any UI change run `pnpm test:visual:update` and commit
   the new PNGs. Add or extend tests where the acceptance criteria are testable (hook tests,
   the A7 pricing assertion, etc.).
9. Update the ledger row to `IN REVIEW` and fill the PR number after opening.
10. **Open the PR.** Title `Agent <id>: <short title>`. Body: link the briefs covered, copy
    their acceptance criteria as a checklist, state how it was verified, note any migration.
    End the body with the Claude Code trailer. (This standing loop is Sidd's explicit,
    ongoing ask to push and PR; do not extend it to merging.)
11. STOP. Summarize: batch done, PR link, what is next and what it is blocked on.

### Rules

- One batch, one PR, per run.
- **Never merge; never push to `main`.** Sidd reviews and merges.
- Dependencies are satisfied only by `MERGED`, not `IN REVIEW`, so code always builds on
  landed work. (Parallelizing via stacked branches is a deliberate change to this protocol;
  the default is serial-on-merged.)
- If a brief is ambiguous or you would have to guess at product intent, STOP and ask rather
  than ship a guess.
- Every run updates this ledger; the ledger on `main` is the durable record.

### Status legend

`TODO` (not started) · `IN REVIEW (#N)` (PR open) · `MERGED (#N)` (landed) ·
`BLOCKED` (note why). A ticked box `[x]` means `MERGED`.

## Progress ledger

Collapsed into batches (lowest Order number first). Each batch is one PR that lands every
brief in its `covers` set; `deps` are the predecessor **batches** that must be `MERGED`
first (deps internal to a batch land in the same PR). The per-item briefs below (Epics A-L)
are unchanged, they are the implementation detail for each batch. `D1` is folded into `A3`
(the Stop button is part of cancellation). `B2` is optional, folded into P3.

The collapse keeps the bulk of the work to 6 thematic batches (P1-P6) and keeps the three
genuinely XL items as their own PRs (X1-X3), so it lands in ~9 PRs rather than ~50, while
not jamming multi-week work into one un-reviewable diff.

### Landed

- [x] **B0a** Tracker doc + motion/liveness doctrine · MERGED (#142)
- [x] **B0b** `audit:motion` script + wired into `pnpm verify` and CI · MERGED (#143)
- [x] **A1** Per-thread turn lock + ordered replay · MERGED (#144)
- [x] **A2** Route loop through `trackedStream` · MERGED (#145)
- [x] **A7** Model/pricing drift guard · MERGED (#146)
- [x] **P1** Foundation hardening (A3, A4, A5, A6, A8, A9) · MERGED (#148)
- [x] **P2.a** Output trust + rendering (C1, C2, C3, C4, C5) · MERGED (#149)
- [x] **P2.b** Conversation control (D2, D3, D4) · MERGED (#150)
- [x] **P3.a** Image paste + file upload (B1) · MERGED (#151)
- [x] **P3.b** @-mentions in the composer (B2) · MERGED (#152)
- [x] **P4.a** Approval card weight + inline diff (E2, E3) · MERGED (#153)
- [x] **P4.b** Per-tool policy + ring-3 recall/undo (E1, E5, E4) · MERGED (#154)
- [x] **P5.a** Design-system adoption pass (H1, I1-I7, J4, J5) · MERGED (#155)
- [x] **P5.b** Component identity redesign + observability (I8, I9, J1, J3) · MERGED (#157)
- [x] **P5.c** Feel parity — cadence + scroll + perf + optimistic (K1-K5) · MERGED (#158)
- [x] **P6.a** Agent-proposed MASHI.md memory (F1) · MERGED (#159)

`audit:motion` grandfathers the pre-buildout dead files in its `EXCLUDE_FILES`. The batch
that makes each one alive MUST remove its carve-out: `thread-view.tsx` (I2/I3, dropped in
P5.a) and `ai-elements/suggestion.tsx` (I6, dropped in P5.a) are now live;
`ai-elements/conversation.tsx` is now live too (K2 in P5.c gave its jump-to-latest
affordance `.mashi-enter`/`.mashi-press`; its carve-out is dropped). The only remaining
`EXCLUDE_FILES` entry is the audit script itself. Adding a new interactive file with no
motion is caught immediately.

### Batches (the 6-PR collapse)

- [x] **1 · P1 · Foundation hardening** · covers A3, A4, A5, A6, A8, A9 · deps: none (A1/A2/A7 merged) · MERGED (#148)
  > Rest of Epic A: cancellation + Stop button (A3), preserve partial text on abort (A8),
  > retry/backoff/reconnect (A4), approval-poll efficiency + abort (A5), per-turn/per-thread
  > token budget (A6), adaptive `max_tokens` (A9). Internal order: A3 → A8 → A4; A3 → A5;
  > A6 → A9.
- **2 · P2 · Output trust + conversation control** · covers C1-C5, D2, D3, D4 · deps: P1 · split into P2.a + P2.b
  > Split because output rendering (C, frontend) and conversation control (D, backend
  > endpoints + truncation/re-run + cross-thread search index + migration) are two cohesive
  > but distinct chunks, too large for one clean PR.
  - [x] **2 · P2.a · Output trust + rendering** · covers C1, C2, C3, C4, C5 · deps: P1 · MERGED (#149) · PR: #149
    > Citations / source chips (C1), readable tool-result summaries + wrap fix (C2), copy
    > buttons (C3), code highlighting + copy via `@streamdown/code` (C4), markdown 16→14 (C5).
    > All frontend; provenance/summary logic is a pure, unit-tested module (`test:provenance`).
  - [x] **2 · P2.b · Conversation control** · covers D2, D3, D4 · deps: P1, P2.a · MERGED (#150) · PR: #150
    > Regenerate last turn (D2, needs A8 from P1), edit-and-resend a prior user turn (D3,
    > shares D2's truncation/re-run path), export thread + cross-thread transcript search
    > (D4, the larger half: a `user_id`-scoped full-text index + a new Search scope). Builds
    > on P2.a's thread-view changes.
- **3 · P3 · Input modalities** · covers B1, B2 · deps: none (A2 merged) · split into P3.a + P3.b
  > Image paste + file upload (B1) is the substantive piece; @-mentions (B2) is optional and
  > only worthwhile "if it falls out cheaply." It doesn't, a mention typeahead needs its own
  > composer rework, so it's split into its own sub-row rather than jammed into B1's diff.
  - [x] **3 · P3.a · Image paste + file upload** · covers B1 · deps: none (A2 merged) · MERGED (#151) · PR: #151
    > Paste / drag-drop / paperclip → upload images, PDFs, and text/CSV to an owner-scoped
    > `agent-attachments` Storage bucket (RLS by uid prefix); descriptors ride with the
    > message, persist on the user row, and resolve to Anthropic image/document content
    > blocks before the model call. New migration `043_agent_attachments.sql` (column + bucket
    > + RLS). Pure module + replay emission unit-tested (`test:attachments`).
  - [x] **3 · P3.b · @-mentions in the composer** · covers B2 · deps: P3.a · MERGED (#152) · PR: #152
    > Optional. `@`-typeahead over items/people/threads that pins a structured reference,
    > skipping the server-side `resolve_reference` round-trip. Needs a mention plugin over
    > the composer (light contenteditable / overlay), so it's deliberately deferred out of
    > B1. Builds on P3.a's composer.
- **4 · P4 · Approvals + safety** · covers E1, E2, E3, E4, E5 · deps: none · split into P4.a + P4.b
  > Split because the work is L-effort: a cohesive approval-card chunk (card weight + body +
  > nested args + inline diff, all frontend + a thin before-snapshot read) is separable from
  > the policy/safety chunk (a new policy table + settings UI + provider-specific recall/undo
  > + ring reclassification). Internal deps: E3→E2; E1→E5; E1+E3→E4.
  - [x] **4 · P4.a · Approval card weight + diff** · covers E2, E3 · deps: none · MERGED (#153) · PR: #153
    > Approval-card rework (E3): action weight (`approvalMetaFor`) so an irreversible SEND
    > reads destructive + `.mashi-glow-focus` while a draft / reaction reads light; multi-line
    > body editing; nested-object / array-element editing via `flattenEditable` / `applyEdits`
    > (no more "non-editable" drops); a user-cancelled call renders as a neutral "Cancelled",
    > not a red error. Inline before/after diff (E2) for update tools, fed by an optional
    > `approvalContext` before-snapshot on the tool def (migration `045_agent_approval_context.sql`
    > adds `agent_approvals.context`). Pure module unit-tested (`test:approval-meta`, 42 asserts).
  - [x] **4 · P4.b · Per-tool policy + recall/undo** · covers E1, E5, E4 · deps: P4.a · MERGED (#154) · PR: #154
    > Per-tool approval policy table + settings UI (E1: always-allow / ask / never, narrowly
    > scoped), ring reclassification (E5: draft_email / react_with_emoji lighter gate, needs
    > E1), post-send recall/undo for ring-3 where the provider allows it (E4: Slack delete,
    > GCal delete, Linear archive; honest "cannot recall" otherwise — needs E1 + E3 from P4.a).
- [x] **5 · P5 · Polish, feel + a11y** · covers H1, I1-I9, J1, J3, J4, J5, K1-K5 · deps: P1, P2 · split into P5.a + P5.b + P5.c · MERGED (all sub-rows landed)
  > The big polish batch: sprint chat height (H1); all of Epic I motion/type/composer/
  > translucency/reasoning/tool-card (I1-I9); usage view (J1), replay (J3), a11y (J4),
  > skeletons (J5); streaming cadence, zero-jank scroll, motion perf budget, instant
  > feedback, feel-parity gate (K1-K5). Split into three cohesive sub-rows. `MERGED` only
  > when every sub-row is. Drops the `audit:motion` carve-outs as each file goes alive:
  > thread-view + suggestion in P5.a (I2/I3/I6), conversation in P5.c (K2).
  - [x] **5 · P5.a · Design-system adoption pass** · covers H1, I1, I2, I3, I4, I5, I6, I7, J4, J5 · deps: P1, P2 · MERGED (#155) · PR: #155
    > The className-level polish the doc calls "low-effort, high-ROI": sprint chat height
    > floor (H1); tool-card hover + chevron + expand motion (I1); message entry motion (I2);
    > streaming caret + reasoning entry (I3); metadata type scale (I4); composer text-sm +
    > glow-focus (I5); real Spotlight suggestion chips (I6); sanctioned translucent user
    > bubble (I7); a11y status/alert roles (J4); skeletons over spinners on load (J5). Adds
    > `.mashi-enter` / `.mashi-caret` CSS utilities. Drops the thread-view + suggestion
    > `audit:motion` carve-outs.
  - [x] **5 · P5.b · Component identity redesign** · covers I8, I9, J1, J3 · deps: P5.a · MERGED (#157) · PR: #157
    > The redesigns, not just motion: reasoning block identity (I8: glyph, accent rail,
    > auto-collapse to metadata), tool-call card identity (I9: per-tool icon + human label +
    > collapsed-state outcome summary + status state machine + sequence rail). Plus the
    > observability pair: agent cost in the usage view (J1, A2 already landed) and turn
    > replay/debug (J3).
  - [x] **5 · P5.c · Feel parity (cadence + scroll + perf + optimistic)** · covers K1, K2, K3, K4, K5 · deps: P5.a, P5.b · MERGED (#158) · PR: #158
    > Streaming cadence smoothing (K1), zero-jank auto-scroll + jump-to-latest (K2), motion
    > perf budget / transform-only expand technique (K3, corrects I1/I8/I9), optimistic
    > send (K4), and the K5 feel-parity acceptance review. Drops the conversation
    > `audit:motion` carve-out (K2 makes it alive).
- [ ] **6 · P6 · Higher ceiling** · covers F1, F2, G2, L1, L2, L3, L4 · deps: P1, P4, P5 · split into P6.a + P6.b + P6.c + P6.d
  > Memory (F1), playbooks (F2), MCP client behind a flag (G2); Experience Phase 1 aliveness:
  > interactive/generative tool components (L1), slash + keyboard-first (L2), quick-action
  > chips (L3), live narration + presence (L4). L1 needs I9 (P5) + E3 (P4); L4 needs I8/K1
  > (P5). Split (as the brief anticipated): the two Feature-Tool capabilities (F1, F2) are each
  > a clean diff; the L1-L4 aliveness cluster is its own frontend-functional sub-row (L4 needs
  > F1's memory moment, so it follows P6.a); G2 is XL-behind-a-flag and stands alone. `MERGED`
  > only when every sub-row is.
  - [x] **6 · P6.a · Agent-proposed memory (F1)** · covers F1 · deps: P1, P4, P5 · MERGED (#159) · PR: #159
    > `propose_memory` ring-2 (write_mashi) tool that OFFERS to append a durable fact to
    > MASHI.md. Routes through the existing approval card as a LIGHT confirm (reuses E3) via a
    > new `requiresApproval` opt-in on the tool def + generalized approval hook; the append is
    > char-cap-guarded (8000, pure `memory.ts`, `test:memory`) and undoable for 30s
    > (`restore_mashi_md` reverse op). Always-on in act mode (CORE_TOOLS) so offers are
    > reliable; the loop already re-reads MASHI.md every turn, so an accepted fact is present
    > next turn. No migration (uses existing `user_profile.mashi_md` + `agent_actions`).
  - [ ] **6 · P6.b · Playbooks (F2)** · covers F2 · deps: P6.a · IN REVIEW (#160) · PR: #160
    > A small library of user-triggerable, parameterized, multi-step playbooks the agent runs
    > step by step with the normal approval gates; a trigger surface in Spotlight. Pairs with
    > G1 (X2). New table + migration (`047_agent_playbooks.sql`). Built-ins live in code
    > (`BUILTIN_PLAYBOOKS`); user playbooks persist to the owner-scoped `agent_playbooks`
    > table. Triggering composes a single user-turn plan prompt (pure `playbooks.ts`,
    > `test:playbooks`) and seeds an orphan thread — no loop change, ring-3 steps still gate.
  - [ ] **6 · P6.c · Aliveness phase 1 (L1, L2, L3, L4)** · covers L1, L2, L3, L4 · deps: P6.a · TODO · PR: -
    > Interactive/generative tool-result components (L1, needs I9 + E3, both merged), slash
    > commands + keyboard-first (L2, shares B2's typeahead), contextual quick-action chips (L3),
    > live tool narration + presence (L4, needs I8/K1 + F1's memory moment from P6.a).
  - [ ] **6 · P6.d · MCP client behind a flag (G2)** · covers G2 · deps: P6.a · TODO · PR: -
    > XL, staged, behind a flag: an MCP *client* so users can register external MCP servers;
    > their tools map into the ring model (external writes → ring-3 approval) + tool-retrieval
    > index + settings UI + encrypted per-user credentials. Honor injection-defense (external
    > tool output is untrusted data). Likely its own multi-PR split when started.

### XL items (kept separate, one PR each)

- [ ] **7 · X1 · Subagent dispatch** · covers F3 · deps: P1 · TODO · PR: -
- [ ] **8 · X2 · Scheduled / cron agent runs + timeline** · covers G1, J2 · deps: P1 · TODO · PR: -
  > G1 (cron runs, gated on A2/A6/A4 all in P1) is the bulk; J2 (cross-thread tool-call
  > timeline) depends on G1 and rides along.
- [ ] **9 · X3 · Artifact workspace** · covers L5, L6, L7, L8 · deps: P3, P4, X2 · TODO · PR: -
  > The big bet, Experience Phase 2. Native artifact runtime (L5, itself split into
  > contract → persistence → render → dispatch sub-rows), split-canvas layout (L6),
  > approval-as-artifact (L7, needs E2 in P4), proactivity across time (L8, needs G1 in X2).
  > This batch is multi-sprint and WILL ship as several stacked sub-PRs, not one.

## How to read a brief

Each brief uses this structure:

- **ID / Title**
- **Surface(s)** affected
- **Layer**: Backend / Feature-Tool / Frontend-Functional / Frontend-Polish (a brief may span layers)
- **Severity** (for bugs/risks): High / Medium / Low. **Value** (for features): High / Medium / Low. **Effort**: S / M / L / XL.
- **Problem** (the long version)
- **Evidence** (live + file:line + measured values)
- **Why it matters for a chief-of-staff**
- **Current behavior**
- **Target state**
- **Implementation approach** (named files, concrete steps)
- **Data / API changes** (if any)
- **Dependencies & sequencing**
- **Risks & mitigations**
- **Acceptance criteria** (testable)
- **Out of scope / future**

## Severity vs value vs effort conventions

- Severity is reserved for correctness, cost, data-integrity, and trust defects.
- Value is reserved for net-new capability.
- Effort: S = under ~1 day, M = ~1 to 3 days, L = ~1 to 2 weeks, XL = a multi-sprint phase.

## Permission rings (referenced throughout)

The tool registry classifies every tool into one of three rings (`src/lib/agent/types.ts:25`):

- **ring 1 `read`**: ~26 tools (get_item, search_board, list_today, resolve_reference, ask_followup_question, etc.). No approval.
- **ring 2 `write_mashi`**: ~22 tools that mutate Mashi's own board/state (create_item, snooze_item, set_plan, log_decision, etc.). 30s undo window.
- **ring 3 `write_world`**: 12 tools that touch external systems (send_email, draft_email, send_slack_message, react_with_emoji, create_calendar_event, create_linear_issue, etc.). Pause-and-approve gate, no undo.

---

## Surface coverage matrix

This document covers improvements on every agent surface. The matrix maps epics to surfaces so "improve across all surfaces" is auditable.

| Surface | Epics that touch it |
|---|---|
| Spotlight (Ask + Search, empty state, recent rail) | A, B, C, D, E, F, G, I, J |
| Item-bound thread (ThreadSheet) | A, B, C, D, E, I, J |
| Sprint Focus-card chat (inline + fullscreen) | A, C, D, E, H, I, J |
| Approval flow | A, E, J |
| Composer (all instances) | B, D, I |
| Mobile / narrow | H, I, J |
| Cross-cutting loop / server | A, E, F, G, J |

## Epic index

- **Epic A: Loop foundation** (backend correctness, cost, cancellation)
- **Epic B: Input modalities** (image/file, mentions)
- **Epic C: Output trust and rendering** (citations, readable tool results, copy, code, type scale)
- **Epic D: Conversation control** (stop, regenerate, edit-resend, export, search)
- **Epic E: Approvals and safety** (per-tool policy, diff, draft vs send, recall/undo, card weight, arg editing)
- **Epic F: Memory and intelligence** (proposed memory, playbooks, subagents)
- **Epic G: Scheduling and connectors** (cron agent runs, MCP client)
- **Epic H: Sprint chat layout** (height starvation fix, embed chrome)
- **Epic I: Design-system adoption / polish** (motion, entry, streaming, type scale, composer, translucency, chips)
- **Epic J: Observability and accessibility** (usage honesty, timeline, replay, aria, skeletons)
- **Epic K: Perceived smoothness / feel parity** (streaming cadence, zero-jank scroll, 60fps motion budget, instant feedback, reference-app feel gate)
- **Epic L: Next-generation experience** (interactive components, slash/keyboard, quick actions, native artifact runtime, split canvas, approval-as-artifact, proactivity), the workspace north-star, phased

---

# EPIC A: Loop foundation

The interactive turn loop is `src/lib/agent/loop.ts::runAgentTurn`, driven by two SSE
routes: `src/app/api/agent/threads/[itemId]/messages/route.ts` and
`.../by-id/[threadId]/messages/route.ts`. Both pass all three rings. This epic hardens
that loop. Most of the higher-ceiling epics (G, F) are unsafe to build until A lands,
because you cannot responsibly schedule or fan out work on a loop you cannot cancel,
bound, or trust to serialize.

## A1. Per-thread turn lock (concurrent-turn / crash replay corruption)

- **Surface**: all threads. **Layer**: Backend. **Severity**: High (data integrity).
- **Problem**: there is no lock or in-flight guard preventing two turns from running
  against the same thread at once. Two browser tabs, a fast double-send, or a retry on a
  slow turn can interleave message-row inserts. On the next turn the loop rebuilds the
  Anthropic message list from those rows in `created_at` order with no tiebreaker; when
  `tool_use` and `tool_result` blocks from two logical turns interleave, they mis-pair.
  Anthropic rejects mismatched tool_use/tool_result with a 400, or worse the agent acts
  on a silently corrupted history. A single-turn process crash between the assistant
  `tool_use` row and the tool-result row produces the same unpaired-block corruption
  without any concurrency.
- **Evidence**: `appendMessage` is a bare insert plus a `last_message_at` bump
  (`threads.ts:159-186`); nothing serializes. `loadThread` orders solely by `created_at`
  (`threads.ts:124`) with no sequence column. `messagesToReplay` (`loop.ts:210`) rebuilds
  from those rows. The user row is appended before streaming (`loop.ts:288`), the
  assistant row at `loop.ts:462`, the tool-result row at `loop.ts:718`.
- **Why it matters**: a chief-of-staff agent that corrupts its own conversation history
  produces wrong actions on the *next* turn, which for ring-3 tools means wrong emails or
  calendar events. This is the scariest latent defect because it is invisible until it
  fires and then is hard to reproduce.
- **Current behavior**: unbounded concurrent turns; nondeterministic ordering on same-ms
  inserts; orphaned tool_use rows possible on crash.
- **Target state**: at most one in-flight turn per thread; turns are totally ordered;
  replay never emits an unpaired tool_use.
- **Implementation approach**:
  1. Add a monotonic `seq` (bigint, per-thread) or a `(created_at, id)` composite order
     to message rows; update `loadThread` ordering and `messagesToReplay` to use it.
  2. Add a thread-level lock: either a `threads.active_turn_id` column with a conditional
     update (claim the turn, reject/queue if already claimed) or a Postgres advisory lock
     keyed by thread id around the turn. Conditional-update is simpler and serverless-safe.
  3. On a claimed-busy thread, the route returns a 409 with a "turn in progress" payload;
     the client shows a non-destructive "Mashi is still working in another tab" state.
  4. Make replay defensive: if a `tool_use` row has no matching `tool_result`, synthesize
     an error tool_result during replay (the model already self-corrects on error results)
     so a crash cannot wedge the thread permanently.
- **Data / API changes**: new column(s) on the messages table and/or threads table; a
  new 409 response shape; an additive migration (see AGENTS.md migration discipline).
- **Dependencies**: pairs naturally with A3 (cancellation) so a stale lock can be released
  on abort. Unblocks G (scheduling) and F3 (subagents).
- **Risks**: a lock that is never released wedges a thread. Mitigate with a short TTL on
  the claim (expire after maxDuration) and release in a `finally`.
- **Acceptance criteria**:
  - Firing two turns on one thread concurrently results in one running and one 409, never
    interleaved rows.
  - Killing the server mid-turn then sending again replays cleanly (no 400 from Anthropic).
  - A synthetic orphaned tool_use row is tolerated by replay.
- **Out of scope**: cross-thread global concurrency limits.

## A2. Route the interactive loop through trackedStream (cost honesty)

- **Surface**: all threads (and the usage view). **Layer**: Backend. **Severity**: High.
- **Problem**: the interactive loop calls the raw Anthropic client, so every interactive
  turn (the dominant cost, Opus, up to 12 model calls per user turn) writes nothing to
  `ai_usage_log`. Only compaction is tracked. The `/settings/usage` view therefore omits
  the largest cost source and silently under-reports. This also violates the explicit
  AGENTS.md invariant: "Always route through trackedCreate / trackedStream."
- **Evidence**: `loop.ts:376` `anthropic.messages.stream({...})` (raw client imported at
  `loop.ts:3`). The only tracked call in the agent subsystem is compaction,
  `compact.ts:179` `trackedCreate(... "agent:compact_thread" ...)`. Pricing table at
  `tracked.ts:29` includes the primary model, so the math would be correct if wired.
- **Why it matters**: you cannot manage what you cannot see. Cost honesty is a precondition
  for budgets (A6), for scheduled runs (G1, which run unattended), and for trusting the
  usage view at all.
- **Current behavior**: interactive turns untracked; usage view shows only compaction.
- **Target state**: every model call in the loop is attributed in `ai_usage_log` with a
  purpose label (e.g. `agent:turn`), thread id, and item id.
- **Implementation approach**:
  1. Replace the raw `anthropic.messages.stream` call in `loop.ts:376` with `trackedStream`
     from `src/lib/anthropic/tracked.ts`, threading a purpose, userId, threadId.
  2. Confirm `trackedStream` exposes the same async-iterable/event surface the loop relies
     on (delta events, final message). If not, extend it to wrap a stream while still
     logging final usage.
  3. Log usage per model call (each tool round-trip), not just per turn, so multi-iteration
     turns are fully attributed.
  4. Add the startup assertion from A7 so a model bump cannot silently log $0.
- **Data / API changes**: more rows in `ai_usage_log`; possibly a new purpose enum value.
- **Dependencies**: standalone. Strongly precedes A6 (budget) and G1 (scheduled runs).
- **Risks**: if `trackedStream` buffers, it could change streaming latency; verify it logs
  on completion without delaying deltas.
- **Acceptance criteria**:
  - A single interactive turn with N tool round-trips produces N usage rows with correct
    input/output token counts and nonzero cost.
  - The usage view total moves materially after one day of normal use.
- **Out of scope**: redesigning the usage view UI (that is J1).

## A3. Stop button and real cancellation (request.signal end to end)

- **Surface**: all threads + composer. **Layer**: Backend + Frontend-Functional. **Severity**: High.
- **Problem**: neither route reads `req.signal`, and the loop has no abort path. A closed
  tab or navigation leaves the loop running to completion server-side, and any pending
  ring-3 approval keeps DB-polling up to the 270s cap. There is also no client Stop button,
  so a user who sees the agent going the wrong way cannot interrupt it.
- **Evidence**: grep across both routes and `src/lib/agent` finds abort handling only as
  dead code (`approval.ts:65,76` accept a `signal` that is never supplied;
  `ring3-approval.ts:55` calls `awaitApprovalDecision` with no signal). The route comment
  at `[itemId]/messages/route.ts:91` only guards `enqueue`, it does not stop work. Client:
  `streamAgentTurn` (`thread-view.tsx:270-332`) has no `AbortController`; the composer is
  merely disabled while streaming.
- **Why it matters**: wasted Opus spend on abandoned turns (compounds A2), wasted Supabase
  queries on abandoned approvals (A5), and a daily UX annoyance. For ring-3, a closed tab
  should not be able to leave a queued write that later fires on approve.
- **Current behavior**: no stop; closed tab keeps loop + approval poll alive to completion.
- **Target state**: a Stop button cancels the in-flight turn; closing the tab aborts the
  fetch, which aborts the server loop, the Anthropic stream, and the approval poll within
  one poll interval.
- **Implementation approach**:
  1. Client: wrap `streamAgentTurn` in an `AbortController`; render a Stop button in the
     composer while streaming that calls `abort()`; abort on unmount.
  2. Route: read `req.signal`, pass it into `runAgentTurn`.
  3. Loop: accept a `signal` param; check `signal.aborted` at each iteration boundary and
     pass `signal` into `trackedStream`/the Anthropic call so the upstream request is
     cancelled.
  4. Approval: thread `signal` into `awaitApprovalDecision` (the param already exists at
     `approval.ts:65`) so the poll loop exits on abort.
  5. On abort, persist whatever assistant text already streamed (see A8) and mark the turn
     released (ties to A1's lock release).
- **Data / API changes**: none beyond a possible "turn cancelled" message status.
- **Dependencies**: shares the loop signature change with A1; pairs with A5 and A8.
- **Risks**: partial side effects if abort lands mid-tool. Mitigate: only abort at
  iteration boundaries, never mid-tool-execution, and never mid-approval-commit.
- **Acceptance criteria**:
  - Clicking Stop ends streaming within ~1s and leaves a coherent (possibly partial) thread.
  - Closing the tab during a turn stops server log growth within one poll interval (verify
    via server logs / usage rows).
  - A pending approval abandoned by a closed tab stops polling.
- **Out of scope**: resuming a cancelled turn (that is a future "continue" feature).

## A4. Transient-error retry, backoff, and mid-stream reconnect

- **Surface**: all threads. **Layer**: Backend. **Severity**: Medium.
- **Problem**: there is no app-level retry/backoff around the model call and no
  stream-reconnect. The SDK retries the *initial* connect (default maxRetries 2 on
  429/5xx/network), but a mid-stream reader drop after the first event is not retried, and
  there is no reconnect. One blip after generation starts ends the turn and persists a
  stream-error marker, discarding already-streamed text.
- **Evidence**: the `for await` over the stream is in a single try/catch (`loop.ts:391-437`);
  on error it emits one error delta, persists `"[stream error] <msg>"` as the assistant row
  (`loop.ts:432`), and returns. No 429-specific branch. SDK client uses default maxRetries
  (`client.ts:3`).
- **Why it matters**: invisible until an Anthropic incident or a flaky network, then every
  long turn dies and loses work. A chief-of-staff agent composing a long brief is exactly
  the case most likely to hit a mid-stream drop.
- **Current behavior**: one blip ends the turn; partial text lost.
- **Target state**: transient connect errors retried with jittered backoff; a mid-stream
  drop attempts a bounded reconnect/continue; on final failure, partial text is preserved
  (A8) and the user gets a "retry" affordance.
- **Implementation approach**:
  1. Wrap the model call in a bounded retry with exponential backoff + jitter for
     classified transient errors (429 with retry-after honored, 500/502/503/network).
  2. On a mid-stream drop, attempt to continue: re-issue with the accumulated assistant
     text so far as a prefix (or simply retry the iteration if no partial text). Cap the
     attempts (e.g. 2) to avoid loops.
  3. Surface a non-fatal "connection hiccup, retrying" delta so the UI can show it without
     killing the turn.
  4. On exhaustion, persist partial text + an explicit error state with a client "Retry"
     button (ties to D2 regenerate).
- **Dependencies**: A8 (partial-text persistence) and A3 (so retries respect abort).
- **Risks**: double-billing on retry; mitigate by only retrying when no usable output was
  produced, and count retries toward the budget (A6).
- **Acceptance criteria**:
  - Injected 503 on connect is retried and the turn succeeds.
  - Injected mid-stream drop does not lose already-streamed text and either continues or
    surfaces a Retry affordance.
- **Out of scope**: full SSE resumable streams with server-side checkpointing.

## A5. Approval poll efficiency and cancellation coupling

- **Surface**: approval flow. **Layer**: Backend. **Severity**: Medium (couples to A3).
- **Problem**: ring-3 approval is a DB-row poll every 750ms with a 270s hard cap. It can
  bail on abort, but the caller never passes a signal, so in practice an abandoned approval
  polls the full 270s, roughly 360 Supabase round-trips per abandoned approval.
- **Evidence**: `createPendingApproval` inserts into `agent_approvals` (`approval.ts:33`);
  `awaitApprovalDecision` polls `pollMs ?? 750` until status flips or `timeoutMs ?? 270_000`
  (`approval.ts:71-72`); abort check at `approval.ts:76` but no signal supplied
  (`ring3-approval.ts:55`). Route `maxDuration = 300`.
- **Why it matters**: cost and load, and it is a quick win once A3 threads the signal.
- **Target state**: approvals stop polling on abort; ideally the poll is replaced or
  augmented by a push (Supabase realtime subscription on `agent_approvals`) to cut idle
  queries.
- **Implementation approach**:
  1. Thread the abort signal into `awaitApprovalDecision` (depends on A3).
  2. Optionally subscribe to the approval row via Supabase realtime and fall back to
     polling, so the common case is event-driven.
  3. Consider a shorter default cap with a "still waiting" heartbeat so a genuinely slow
     human approval can extend rather than silently expire at 270s.
- **Dependencies**: A3.
- **Acceptance criteria**: an abandoned approval stops polling within one interval; an
  approved decision is picked up within ~1s.
- **Out of scope**: redesigning the approval data model.

## A6. Per-turn and per-thread token/cost budget

- **Surface**: all threads + scheduled runs. **Layer**: Backend. **Severity**: Medium-High.
- **Problem**: the only ceiling on a turn is `maxIterations` (default 6, max 12). There is
  no token or cost budget. Combined with untracked spend (A2) and up to 12 Opus iterations,
  a runaway tool loop is both uncapped in cost and invisible.
- **Evidence**: `loop.ts:369` `maxIters = clamp(opts.maxIterations ?? 6, 1, 12)`. Grep for
  budget/cost in `src/lib/agent` finds only doc strings.
- **Why it matters**: required before any unattended/scheduled run (G1) can be trusted, and
  a safety net for interactive runaway loops.
- **Target state**: a configurable per-turn token/cost budget (and an optional per-thread
  rolling budget); when exceeded, the loop stops gracefully with a clear "budget reached"
  message rather than silently continuing.
- **Implementation approach**:
  1. Accumulate input+output tokens per turn from the tracked usage (A2 provides this).
  2. Enforce a soft budget that ends the loop at the next iteration boundary with a clear
     terminal message; make the default generous for interactive, tighter for scheduled.
  3. Expose the budget in the run options so scheduled runs (G1) can set their own.
- **Dependencies**: A2 (need real token counts).
- **Acceptance criteria**: a synthetic loop that would exceed the budget halts at the
  budget with a clear message and a usage row reflecting the spend.
- **Out of scope**: per-user monthly quotas (billing concern, separate).

## A7. Model/pricing drift guard

- **Surface**: cross-cutting. **Layer**: Backend. **Severity**: Low (latent).
- **Problem**: `MODELS.primary` is `claude-opus-4-7` while the deployed env runs Opus 4.8.
  If `MODELS.*` is bumped to a 4.8 id without adding a `PRICING` row, `priceFor` falls
  through to an all-zero default and silently logs $0 cost.
- **Evidence**: `client.ts:14` model ids; `tracked.ts:29-30` pricing keys; default-zero
  fallback at `tracked.ts:39`.
- **Target state**: a startup/CI assertion that every id in `MODELS` has a `PRICING` entry;
  fail loud rather than logging $0.
- **Implementation approach**: add a unit test or module-load assertion iterating `MODELS`
  against `PRICING`. Wire into `pnpm verify`.
- **Dependencies**: independent; most valuable once A2 makes tracking the default.
- **Acceptance criteria**: removing a pricing row fails the test.

## A8. Preserve partial streamed text on error/abort

- **Surface**: all threads. **Layer**: Backend. **Severity**: Medium.
- **Problem**: on a mid-stream throw the loop persists the literal `"[stream error] <msg>"`
  and drops whatever text was already streamed to the user. The user saw partial text; the
  thread records only the error marker, so replay loses it and the next turn has incoherent
  history.
- **Evidence**: `loop.ts:432-435` persists the marker; the accumulated `blockState`
  (`loop.ts:395-417`) is discarded.
- **Target state**: persist the accumulated assistant text plus a non-destructive error
  annotation, so what the user saw is what the thread stores and what replay sees.
- **Implementation approach**: in the catch, write the accumulated text (if any) as the
  assistant message with an `error` flag/metadata rather than replacing it with the marker;
  ensure tool_use/tool_result pairing stays valid (ties to A1's defensive replay).
- **Dependencies**: A1 (replay), A4 (retry), A3 (abort).
- **Acceptance criteria**: an injected mid-stream error leaves the partial answer visible
  and replay-safe.

## A9. Raise or make adaptive the per-call max_tokens for drafting

- **Surface**: all threads, especially drafting. **Layer**: Backend. **Severity**: Medium.
- **Problem**: every model call caps `max_tokens` at 1024. For a chief-of-staff agent
  composing emails, Slack posts, Linear issue bodies, or a weekly brief, 1024 output tokens
  truncates the draft. The loop treats a `max_tokens` stop as a normal end, so a truncated
  draft can flow straight into a ring-3 approval card and be sent.
- **Evidence**: `loop.ts:381` `max_tokens: 1024`; only `tool_use` is special-cased at the
  stop (`loop.ts:478`).
- **Target state**: a higher default, or an adaptive cap (raise when the turn is composing
  a draft / writing a long answer), plus explicit handling of `stop_reason: "max_tokens"`
  so truncation is detected and either continued or flagged rather than silently approved.
- **Implementation approach**:
  1. Raise the default to a sensible value for prose (e.g. several thousand) with cost
     bounded by A6.
  2. Detect `stop_reason === "max_tokens"` and either auto-continue the generation or mark
     the message truncated and block it from being sent without explicit re-generation.
- **Dependencies**: A6 (budget), E (approval treats truncated drafts carefully).
- **Acceptance criteria**: a long-draft prompt produces a complete draft; an artificially
  low cap is detected as truncation, not treated as a finished answer.

---

# EPIC B: Input modalities

The single biggest daily-use capability gap for this role. Verified three ways: live DOM
(0 file inputs on the page, no attach button, no accept attrs), composer code
(`composer.tsx:43` plain Textarea, no onPaste/onDrop/file input), and intake schema
(`messages/route.ts:44` `z.string()` only; `messagesToReplay` never builds image/document
content blocks at `loop.ts:226`). The model is vision-capable; only the plumbing is missing.

## B1. Image paste and file upload (screenshots, PDF, CSV)

- **Surface**: composer (Spotlight, item thread, sprint chat). **Layer**: Feature-Tool +
  Backend + Frontend-Functional. **Value**: High. **Effort**: M.
- **Problem**: a chief-of-staff constantly works from artifacts: a screenshot of an email
  thread, a P&L PDF, a CSV of leads, a deck. Today none of these can enter the agent. The
  most natural gesture (paste a screenshot, drag a PDF) does nothing.
- **Evidence**: see epic preamble. Intake is text-only end to end, so there is no
  half-working path to mistake for support; it is cleanly absent.
- **Why it matters**: this changes daily use more than any other single item. It is the
  difference between "ask Mashi about this artifact" and "retype the artifact."
- **Current behavior**: textarea only; no upload, paste, or drop.
- **Target state**: paste an image or drag/drop one or more files (image, PDF, CSV) into
  the composer; they upload, render as attachment chips, and are sent to the model as
  vision/document content blocks; the agent can read and reason over them.
- **Implementation approach**:
  1. Composer (`composer.tsx`): add `onPaste` (grab `clipboardData` image items), `onDrop`
     + drag-over styling, and a hidden `<input type="file" accept=...>` behind a paperclip
     button. Render attachment chips with remove buttons and per-file progress.
  2. Upload: store files in Supabase Storage scoped by `user_id` (multi-tenancy invariant);
     return signed references. Never put file bytes in the message row.
  3. Intake schema (`messages/route.ts:44`): extend from `z.string()` to accept an
     `attachments: Attachment[]` array (type, storage ref, mime, size) alongside the text.
  4. Message building (`loop.ts:226` / `messagesToReplay`): construct Anthropic content
     blocks: `type: "image"` for images, `type: "document"` for PDFs; for CSV/large text,
     decide between a document block and a server-side extract-to-text path.
  5. Persistence: store attachment references on the message row so replay re-attaches them
     (and so the thread renders them on reload). Decide on a retention policy.
  6. Limits and safety: enforce max file count, per-file and per-turn byte caps, allowed
     mime types; reject/strip anything else. Respect the safety rule against auto-filling
     forms / handling sensitive financial-account numbers; do not OCR-and-store sensitive
     identity docs without explicit user action.
- **Data / API changes**: new `attachments` field on the message intake + message row;
  Storage bucket + RLS policy (owner-only, per multi-tenancy doctrine); additive migration.
- **Dependencies**: independent of epic A, but should land after A so the heavier turns
  (vision is token-heavy) are tracked (A2) and bounded (A6).
- **Risks**: token cost balloon on large images/PDFs (bound via A6 + downscaling); storage
  cost and PII retention (retention policy + signed URLs, never public).
- **Acceptance criteria**:
  - Pasting a screenshot shows a chip, uploads, and the agent can answer questions about
    the image content.
  - Dragging a PDF in works the same; the agent can summarize it.
  - Reloading the thread re-renders the attachments and replay still works.
  - A file over the size cap or wrong mime is rejected with a clear message.
- **Out of scope**: in-thread file editing, generating downloadable artifacts (that is a
  Skills/Cowork concern), audio/voice.

## B2. @-mentions in the composer (optional, lower priority)

- **Surface**: composer. **Layer**: Frontend-Functional + Feature-Tool. **Value**: Medium. **Effort**: M.
- **Problem**: the common opening move is "do X to <some item/person/thread>." Today the
  user types it in prose and the agent resolves references server-side via
  `resolve_reference`, surfaced as candidate cards (which works well, see the
  clarifying-question flow). But there is no inline `@`-mention to pin a reference up front.
- **Evidence**: no `@`-handler in `composer.tsx`; resolution is server-side only.
- **Why it matters**: speeds the common case and reduces a round-trip of disambiguation.
- **Current behavior**: prose only; disambiguation happens after send via candidate chips.
- **Target state**: typing `@` opens a typeahead over items/people/threads; selecting one
  inserts a pinned reference token that is passed as a structured reference, skipping the
  resolve round-trip.
- **Implementation approach**: a mention plugin over the textarea (or a light contenteditable)
  backed by the same search the Spotlight "Search" tab uses; pass selected references as a
  structured field that the loop injects as known context, bypassing `resolve_reference`
  for those tokens.
- **Dependencies**: reuses search infra; complements the existing candidate-card flow,
  does not replace it.
- **Acceptance criteria**: `@` typeahead resolves and pins a reference; the agent uses it
  without a disambiguation round-trip.
- **Out of scope**: rich-text composing beyond mentions.

---

# EPIC C: Output trust and rendering

For a chief-of-staff agent, the output surface is a *trust* surface: where did this come
from, can I copy it, is it readable. Several primitives already exist in the codebase but
are not wired.

## C1. Wire the Sources citation primitive

- **Surface**: all threads. **Layer**: Frontend-Functional. **Value**: Medium-High. **Effort**: S.
- **Problem**: the agent reads Slack, Gmail, Linear, meetings, calendar, and the board, but
  the answer never shows provenance. A `<Sources>` primitive is fully implemented and never
  rendered. Trust in an exec-function agent depends on "where did this come from."
- **Evidence**: `src/components/ai-elements/sources.tsx` (Sources/SourcesTrigger/
  SourcesContent/Source) exists; grep shows zero real imports; `thread-view.tsx` never
  renders it. Tool results that fetched the source render only as collapsed raw JSON.
- **Target state**: when a turn used read tools that returned identifiable sources (a Slack
  thread, an email, a meeting, a Linear issue), the answer footer shows source chips that
  link to or expand the source.
- **Implementation approach**:
  1. Have read-tool results carry lightweight source descriptors (id, kind, title, deep
     link) where available.
  2. Aggregate the turn's sources and render `<Sources>` below the assistant message.
  3. Link chips to the item detail / external deep link.
- **Dependencies**: pairs with C2 (readable tool results) since both surface provenance.
- **Acceptance criteria**: an answer derived from a Slack thread shows a clickable source
  chip that opens that thread/source.
- **Out of scope**: inline sentence-level citations.

## C2. Make tool-result output readable (the provenance surface)

- **Surface**: all threads. **Layer**: Frontend-Functional + Frontend-Polish. **Severity**: Medium.
- **Problem**: tool outputs render as raw `JSON.stringify` in a `max-h-40` `<pre>` with
  `break-all`, collapsed by default. For a CoS agent this is the provenance surface and it
  is both unreadable (break-all mangles JSON) and hidden. There is no search and no copy.
- **Evidence**: `tool.tsx:126,157` render `<pre>`; default collapsed at
  `thread-view.tsx:649`.
- **Target state**: tool results render as structured, readable summaries (key fields,
  counts, titles) with a "view raw" expander; long results are scrollable not `break-all`;
  copy and (for long results) search are available.
- **Implementation approach**:
  1. For known tool shapes (search_board, list_today, search_messages, etc.), render a
     compact typed summary instead of raw JSON.
  2. Keep a "raw" disclosure for debugging; fix wrapping (no `break-all` on JSON, use a
     proper code/pre with wrap + horizontal scroll).
  3. Add copy (C3) and, for long outputs, a find-in-result.
- **Dependencies**: C1 (sources), C3 (copy).
- **Acceptance criteria**: a `search_board` result renders as a readable list with titles,
  not a JSON blob; raw is one click away; copy works.

## C3. Copy buttons (answers, drafts, code, tool output)

- **Surface**: all threads. **Layer**: Frontend-Functional. **Value**: Medium. **Effort**: S.
- **Problem**: nothing in the thread is copyable via a button. The user copies drafts
  constantly. A `MessageAction` primitive exists but is never instantiated.
- **Evidence**: `MessageAction` defined `message.tsx:74-103`, never used in `thread-view.tsx`.
- **Target state**: hover/footer copy buttons on assistant answers, on drafted-message
  bodies (so a draft can be pasted elsewhere), on code blocks, and on tool-result raw.
- **Implementation approach**: instantiate `MessageAction` in `thread-view.tsx` for the
  assistant message footer; add copy to the draft preview and to code blocks (C4 gives code
  blocks a copy affordance for free if `@streamdown/code` is wired).
- **Dependencies**: C4 for code-block copy.
- **Acceptance criteria**: every assistant answer and every drafted body has a working copy
  button with feedback.

## C4. Code highlighting + copy (wire @streamdown/code) or drop dead deps

- **Surface**: all threads. **Layer**: Frontend-Functional. **Value**: Medium (Low for this role's typical content). **Effort**: S.
- **Problem**: `@streamdown/{cjk,code,math,mermaid}` are installed but imported nowhere, so
  they bloat the lockfile with no runtime benefit. Code blocks have no highlighting and no
  copy. For a CoS agent code is rare, but config snippets, SQL, and tables do appear.
- **Evidence**: `package.json:38-41` lists the four plugins; grep finds no `@streamdown/*`
  import; `message.tsx:18` comment says plugins were dropped "to keep bundle lean";
  `tool.tsx:22-24` confirms the shiki CodeBlock was dropped.
- **Target state**: either wire `@streamdown/code` (gets highlighting + a copy button on
  code blocks, directly improving C3) or remove all four dead deps. Decide explicitly.
- **Implementation approach**: if wiring, add the plugin to the Streamdown config in
  `message.tsx:107` and `reasoning.tsx:227`; verify bundle impact. If dropping, remove from
  `package.json` and lockfile.
- **Dependencies**: C3.
- **Acceptance criteria**: code blocks either highlight + copy, or the dead deps are gone
  and the bundle shrinks. No middle state.

## C5. Markdown body type scale fix (16px to 14px)

- **Surface**: all threads. **Layer**: Frontend-Polish. **Severity**: Medium (token violation).
- **Problem**: assistant markdown renders at 16px against the sanctioned `text-sm` (14px)
  body token. `html/body` set no base size, and Streamdown v2 applies its own element-level
  prose typography that overrides the wrapper's `text-sm`. The whole agent surface "feels
  big" partly because of this.
- **Evidence**: measured 16px on assistant body live; `message.tsx:111` passes only layout
  classes to Streamdown; `globals.css:115-122` sets no base font-size. User bubbles are
  correctly 14px (`thread-view.tsx:622`).
- **Target state**: assistant markdown body, list items, and inline text render at 14px per
  the doctrine; headings scale from there.
- **Implementation approach**: at the Streamdown boundary (`message.tsx:111`) add
  `text-sm [&_p]:text-sm [&_li]:text-sm` (descendant selectors to beat Streamdown's
  element-level specificity). Verify against the actual emitted classes once `node_modules`
  is installed.
- **Dependencies**: pairs with I4 (metadata type scale).
- **Acceptance criteria**: measured assistant paragraph/list font-size is 14px; headings
  remain proportional; no regression to user bubbles.

---

# EPIC D: Conversation control

Recovery and control affordances that every modern agent UI has and Mashi lacks. D1 (stop)
is implemented as part of A3; it is listed here for surface completeness.

## D1. Stop button (see A3)

- Implemented in A3 (cancellation). The visible Stop button lives in the composer.

## D2. Regenerate last turn

- **Surface**: all threads. **Layer**: Frontend-Functional + Backend. **Value**: High. **Effort**: M.
- **Problem**: if the agent misreads or a turn dies (A4), there is no way to re-run it.
- **Evidence**: no regenerate control in `thread-view.tsx`.
- **Target state**: a Regenerate action on the last assistant turn re-runs from the prior
  user message, replacing the assistant turn (and its tool calls) cleanly.
- **Implementation approach**: server endpoint that truncates the thread back to the last
  user message (soft-delete the assistant + tool rows, preserving auditability) and re-runs
  the loop; client action + optimistic UI. Must respect the turn lock (A1).
- **Dependencies**: A1 (lock + clean truncation), A8 (partial-text), pairs with D3.
- **Acceptance criteria**: regenerate replaces the last answer without corrupting replay;
  ring-2 side effects from the discarded turn are reconciled (undo or no-op).
- **Risks**: a regenerated turn must not double-apply a ring-2 write from the discarded
  attempt; reuse the undo machinery (E4) or only regenerate turns with no committed writes.

## D3. Edit-and-resend a prior user turn

- **Surface**: all threads. **Layer**: Frontend-Functional + Backend. **Value**: High. **Effort**: M.
- **Problem**: a user who phrased a request badly cannot fix it; they must start over.
- **Evidence**: user turns render as static `<p>` (`thread-view.tsx:618-625`).
- **Target state**: edit a prior user message; the thread truncates to that point and
  re-runs from the edited message.
- **Implementation approach**: same truncation/branch machinery as D2 keyed to an earlier
  user message; decide whether to branch (keep the old path) or replace (simpler). Replace
  is the lower-risk first version.
- **Dependencies**: D2 (shared truncation/re-run path), A1.
- **Acceptance criteria**: editing an earlier user message re-runs from there with a clean
  history.
- **Out of scope**: full branching/tree history (a future enhancement).

## D4. Export thread (markdown/JSON) and cross-thread content search

- **Surface**: Spotlight + all threads. **Layer**: Frontend-Functional. **Value**: Medium. **Effort**: M.
- **Problem**: there is no user-reachable export, and no content search across threads. The
  Spotlight "Recent" rail is recency, and the "Search" tab searches board/Gmail/Slack, not
  agent transcripts. Value grows with thread count.
- **Evidence**: `ConversationDownload` + `messagesToMarkdown` exist (`conversation.tsx:109-168`)
  but are never rendered. Recent rail calls `/api/agent/threads/recent` ordered by recency
  (`spotlight-agent.tsx:214-225`).
- **Target state**: an Export action on a thread (markdown and JSON); a content search over
  agent thread transcripts (a new search mode or scope in the Spotlight Search tab).
- **Implementation approach**:
  1. Export: render the existing `ConversationDownload` in the thread header.
  2. Search: index thread messages (Postgres full-text or the existing embeddings infra)
     scoped by `user_id`; add a "Conversations" scope to the Search tab.
- **Dependencies**: independent; export is the cheap half, search the larger half.
- **Acceptance criteria**: a thread exports to valid markdown/JSON; searching a phrase that
  appears only in a past thread returns that thread.

---

# EPIC E: Approvals and safety

The approval gate is the boundary for all external-world actions, so it is the most
trust-sensitive surface. The mechanics are solid (DB-row pause-and-approve, hook layer);
the gaps are policy, clarity, reversibility, and editing fidelity.

## E1. Per-tool approval policy (always-allow / ask / never)

- **Surface**: approval flow + a settings surface. **Layer**: Feature-Tool. **Value**: Medium. **Effort**: M.
- **Problem**: approval is uniform per call for every ring-3 tool; there is no remembered
  "always allow this tool" or "never." The user re-approves the same safe action repeatedly,
  and there is no way to harden a dangerous one.
- **Evidence**: `ring3-approval.ts:30` matches `ring === "write_world"` with no per-tool or
  per-recipient policy; every call writes a fresh `agent_approvals` row and blocks; even
  edit-then-reapprove re-gates (`ring3-approval.ts:67`).
- **Target state**: a per-user, per-tool (optionally per-recipient/scope) policy of
  always-allow / ask / never, surfaced in settings and adjustable inline from the approval
  card ("always allow draft_email to myself").
- **Implementation approach**:
  1. New `agent_tool_policies` table (user_id, tool, scope, mode) with owner-only RLS.
  2. The ring-3 hook consults the policy before creating an approval: never -> deny,
     always-allow (matching scope) -> proceed without a card, ask -> current behavior.
  3. Inline "always allow this" affordance on the approval card writes a policy row.
  4. Guardrails: never allow a blanket always-allow on send to arbitrary recipients; scope
     always-allow narrowly (self, a specific channel) per the privacy doctrine.
- **Data / API changes**: new table + migration; new settings UI.
- **Dependencies**: pairs with E2/E3 (card changes).
- **Risks**: an over-broad always-allow defeats the safety gate. Mitigate with narrow
  scoping and an audit trail of policy-bypassed actions.
- **Acceptance criteria**: setting always-allow for a scoped action skips the card for that
  scope only; never blocks it entirely; ask is unchanged.

## E2. Inline diff/preview on approval cards

- **Surface**: approval flow. **Layer**: Frontend-Functional. **Value**: Medium. **Effort**: M.
- **Problem**: the card shows flat key/value args, no before/after. For update actions
  (update_calendar_event, update_linear_issue, update_item) the user cannot see what
  changes.
- **Evidence**: `ArgsPreview` (`approval-card.tsx:249-265`) renders flat rows; there is no
  "before" for updates.
- **Target state**: for update/mutate actions, show a before/after diff (current value vs
  proposed); for create/send, keep the clear field preview with the full body rendered.
- **Implementation approach**: have update tools include the current value in the approval
  payload; render a diff component in the card; for sends, render the body as it will appear
  (E3).
- **Dependencies**: E3 (card weight), E5 (arg editing).
- **Acceptance criteria**: an update action shows old vs new for each changed field.

## E3. Approval card weight + draft vs send distinction + body editing

- **Surface**: approval flow. **Layer**: Frontend-Polish + Frontend-Functional. **Value**: High. **Effort**: M.
- **Problem**: a ring-3 world-write uses the same primary-blue Approve button as any benign
  action, distinguished only by a thin amber border. The Edit mode exposes single-line
  string inputs only; nested/array args render literally "non-editable" and are dropped from
  the draft. The email BODY is a single-line input, painful for a real message. There is
  also a parallel unused `Confirmation` primitive.
- **Evidence**: measured: amber border on "APPROVAL NEEDED", primary-blue Approve;
  `ArgsEditor` only edits `isStringish` values (`approval-card.tsx:267-319,342-344`);
  `normalizeArgs` drops non-stringish (`321-329`); BODY is a single-line input (live);
  `ai-elements/confirmation.tsx` is a full unused primitive.
- **Why it matters**: sending an email or Slack message on someone's behalf is the highest-
  stakes action the agent takes; the UI should make it feel weighty and let the user fix
  the content before it goes.
- **Target state**: ring-3 sends get destructive/confirm-weight styling (distinct color,
  `.mashi-glow-focus` on the primary), a clear "draft" (reversible) vs "send" (not) visual
  distinction, a multi-line Textarea for bodies, and editable nested/array args.
- **Implementation approach**:
  1. Restyle the card: stronger header, distinct button treatment for send vs draft vs
     ring-2; add `.mashi-glow-focus` to the primary; consider adopting `Confirmation` or
     `AlertDialog` posture for sends.
  2. Replace the single-line BODY input with a `Textarea`.
  3. Extend `ArgsEditor`/`normalizeArgs` to handle nested objects and arrays (recursive
     editor or a structured JSON editor for complex args) instead of dropping them.
  4. Distinguish a cancelled write from a tool error (today cancel surfaces as "Error").
- **Dependencies**: E2 (diff), E1 (policy affordance lives here).
- **Acceptance criteria**: a send card is visually distinct from a draft and from a ring-2
  action; the body edits in a multi-line field; an array arg is editable; cancelling shows
  "cancelled," not "error."

## E4. Post-send recall / undo for ring-3 where the provider allows it

- **Surface**: approval flow + thread. **Layer**: Feature-Tool. **Value**: Medium-High. **Effort**: M.
- **Problem**: ring-2 board edits are reversible for 30s; ring-3 real-world actions (email,
  Slack, calendar, Linear) have no undo and rely solely on the pre-send gate. There is no
  "recall the message I just sent" path. This asymmetry is the load-bearing trust gap for
  an exec-function agent.
- **Evidence**: `undo.ts:20` 30s window, ring-2 only (`undo.ts:97-101`); ring-3 omits undo
  by design.
- **Target state**: where the provider supports it, offer a short post-action recall/undo:
  Gmail "undo send" window, delete a just-sent Slack message, delete a just-created calendar
  event, delete a just-created Linear issue. Where it is impossible, say so explicitly.
- **Implementation approach**:
  1. For each ring-3 tool, implement a reverse action if the provider API allows (Slack
     delete, GCal delete, Linear archive/delete, Gmail draft-delay-send if feasible).
  2. After a confirmed ring-3 action, show a brief "Undo" affordance (mirroring ring-2) that
     calls the reverse action; after the window, show "sent, cannot recall" honestly.
  3. Log both the action and any reversal to the audit trail.
- **Dependencies**: E1 (policy), E3 (card).
- **Risks**: provider APIs differ; some sends are truly irreversible. Be honest per tool.
- **Acceptance criteria**: a just-sent Slack message can be deleted within the window; an
  irreversible action clearly states it cannot be recalled.

## E5. Ring classification review (draft_email, react_with_emoji)

- **Surface**: approval flow. **Layer**: Feature-Tool. **Severity**: Low (UX weight). **Effort**: S.
- **Problem**: `draft_email` (creates a Gmail draft, no send) and `react_with_emoji` are
  both ring-3, so creating a mere draft or adding an emoji triggers the full approval card,
  which is heavier UX than the action warrants.
- **Evidence**: `draft_email.ts:29` ring write_world; `react_with_emoji` ring-3 in registry.
- **Target state**: reconsider whether reversible/low-stakes external actions (creating a
  draft that is not sent; an emoji reaction) warrant a lighter gate, possibly a ring-2-style
  treatment with undo, or a per-tool policy default of always-allow (E1).
- **Implementation approach**: either reclassify with care (a draft still touches the
  external account, so weigh privacy), or set sensible default policies under E1.
- **Dependencies**: E1.
- **Acceptance criteria**: creating a draft or adding an emoji is not as heavy as sending an
  email, while still respecting account privacy.

---

# EPIC F: Memory and intelligence

## F1. Agent-proposed MASHI.md memory writes

- **Surface**: all threads + settings. **Layer**: Feature-Tool. **Value**: Medium. **Effort**: S-M.
- **Problem**: MASHI.md is a single user-edited free-text blob; the agent never proposes
  additions. A chief-of-staff agent learns durable facts ("Sidd prefers bullets," "the
  brand thing means MAP-435") and should be able to offer to remember them.
- **Evidence**: stored in `user_profile.mashi_md` (8000-char cap, `mashi-md/route.ts:16`);
  only the settings editor writes it (`mashi-memory-editor.tsx:55`); the loop only reads it
  (`loop.ts:350-367`); no tool writes it.
- **Target state**: the agent can propose a memory addition ("Want me to remember X?"); on
  user approval it appends to MASHI.md (with a diff preview, respecting the char cap).
- **Implementation approach**:
  1. A ring-2 (write_mashi, undoable) `propose_memory` tool that stages a proposed addition.
  2. Surface it as a lightweight confirm (not a heavy ring-3 card) with the exact text to
     be appended; on accept, append to `mashi_md` and bump.
  3. Guard the char cap; offer to consolidate when near the limit.
- **Dependencies**: reuses the approval/confirm UI (E3) in a lighter form.
- **Acceptance criteria**: the agent offers to remember a durable fact; accepting appends it
  and it is present in the next turn's context.
- **Out of scope**: automatic memory writes without confirmation; structured memory beyond
  free text.

## F2. Skills / playbooks (canned multi-step procedures, in-app)

- **Surface**: Spotlight + threads. **Layer**: Feature-Tool. **Value**: Medium. **Effort**: M-L.
- **Problem**: there is no in-app concept of a saved multi-step procedure the user can
  trigger ("run my Monday pipeline refresh"). The agent has flat tools and a system prompt.
  (There are Claude-Code-side skills, but those are not the in-app Mashi agent.)
- **Evidence**: no playbook/procedure registry in `src/lib/agent`; grep hits for "playbook"
  are incidental prose.
- **Target state**: a small library of user-triggerable playbooks (named, parameterized,
  multi-step) that the agent executes step by step with the normal approval gates.
- **Implementation approach**: a playbook definition (ordered steps referencing tools +
  prompts), a trigger surface in Spotlight (a "Playbooks" mode or chips), and execution that
  drives the loop with the playbook as a plan. Strong fit with G1 (scheduled runs) since a
  playbook is exactly what you would schedule.
- **Dependencies**: best after A (bounded loop) and pairs with G1.
- **Acceptance criteria**: a user triggers a saved 3-step playbook; the agent runs the steps
  with approvals; parameters are honored.
- **Out of scope**: a full visual playbook builder (start with code-defined or simple form).

## F3. Subagent dispatch (focused sub-conversations)

- **Surface**: threads. **Layer**: Feature-Tool + Backend. **Value**: Medium. **Effort**: L.
- **Problem**: `spawn_follow_up` spawns a board item, not a subagent. There is no way to
  fan out a focused sub-task with its own context and return a result.
- **Evidence**: `spawn_follow_up.ts:74` inserts an `s2d_items` row and seeds a child thread
  via context inheritance, but no second model loop is dispatched.
- **Target state**: the agent can dispatch a bounded subagent for a focused task (e.g.
  "research X across these threads") and incorporate the result, with the subagent's cost
  tracked and budgeted.
- **Implementation approach**: a `dispatch_subagent` tool that runs a child `runAgentTurn`
  with a constrained toolset and its own budget (A6), returns a structured result, and is
  fully tracked (A2). Must respect the turn lock model (A1) and cancellation (A3).
- **Dependencies**: hard-gated behind A (cannot safely fan out on an un-cancelable,
  unbudgeted, un-tracked loop).
- **Acceptance criteria**: a dispatched subagent runs, is tracked and budgeted, and its
  result is folded into the parent turn; cancelling the parent cancels children.
- **Out of scope**: arbitrary recursion depth (cap it).

---

# EPIC G: Scheduling and connectors

The two highest-ceiling strategic items. Both are unsafe before epic A.

## G1. Scheduled / cron-driven agent runs ("draft my Monday pulse")

- **Surface**: a new scheduled-runs surface + result delivery. **Layer**: Feature-Tool +
  Backend. **Value**: High. **Effort**: M-L.
- **Problem**: there is no autonomous scheduled agent run. The only crons are data sync.
  "Draft my Monday pulse at 8am" is the most chief-of-staff feature imaginable and is absent.
  Additionally, the approval gate hard-requires a `threadId`, so an unattended run cannot
  currently perform a world-write at all.
- **Evidence**: `vercel.json:16-19` has two crons (`/api/sync/all`, `/api/activity/maintenance`),
  both sync/maintenance; no cron invokes `runAgentTurn`; `ring3-approval.ts:33-40` denies a
  world-write with no `threadId`.
- **Target state**: a user can schedule a recurring agent task (a prompt or a playbook, F2)
  that runs unattended, produces a result, and delivers it to a notification/inbox surface;
  any world-writes it wants either queue for approval (delivered to the user) or are governed
  by an explicit pre-authorization policy (E1).
- **Implementation approach**:
  1. A schedule definition (user_id, cron, prompt/playbook, delivery target) with owner-only
     RLS; a cron route that enumerates due schedules and runs the loop per user.
  2. Solve the unattended-write problem: either runs are read/plan-only by default and queue
     any world-write as a pending approval delivered to the user (notification + a thread to
     approve in), or an explicit scoped pre-authorization (E1) permits specific sends.
  3. A result-delivery surface: a notification + a generated thread/brief the user opens.
  4. Hard requirements: runs are tracked (A2), budgeted (A6), and cancelable/idempotent;
     a missed/failed run is retried per A4 and reported.
- **Data / API changes**: schedule table + migration; a new cron route; a notifications/
  results surface; relax or adapt the `threadId` requirement for scheduled approvals.
- **Dependencies**: A2, A6, A4 (hard), F2 (natural pairing), E1 (for any unattended sends).
- **Risks**: unattended sends are the highest-risk action in the product; default to
  read/plan + queued approval, never silent send, until E1 scoping is proven.
- **Acceptance criteria**: a scheduled "draft my Monday pulse" runs at the set time, produces
  a brief delivered to a surface the user can open, costs are tracked and bounded, and no
  world-write happens unattended without an explicit scoped policy.
- **Out of scope**: inbound webhooks (separate, low priority for this role).

## G2. MCP client (connect user-installed MCP servers)

- **Surface**: settings + the agent toolset. **Layer**: Feature-Tool + Backend. **Value**: High ceiling. **Effort**: XL (a phase, behind a flag).
- **Problem**: Mashi is only an MCP *server* (and a read-only one), with no MCP *client*. It
  cannot connect to user-installed MCP servers (QuickBooks, HubSpot, CRM, etc.). For a
  chief-of-staff agent, "connect to everything the exec already uses" is the strategic
  answer, and it is entirely absent.
- **Evidence**: server present (`src/lib/mcp/handler.ts`, tokens, 17 read-only tool routes);
  grep for `@modelcontextprotocol`, `SSEClientTransport`, `StreamableHTTP`, `McpClient`,
  `mcp_servers` returns zero hits. The exposed MCP server surface is ring-1 reads only.
- **Target state**: a user can register external MCP servers; their tools appear in the
  agent's toolset (subject to the ring model + approval gate), enabling the agent to read and
  act across the exec's full stack.
- **Implementation approach** (staged, behind a flag):
  1. An MCP client: connection management (transport, auth, per-user credentials encrypted at
     rest like other OAuth tokens), tool discovery, schema ingestion.
  2. Map external tools into the ring model: default external write tools to ring-3 (approval
     gate); reads to ring-1. Feed them through the same hook layer and tool-retrieval (the
     embedding retrieval must index external tools too).
  3. A settings surface to add/remove servers, see their tools, and set policies (E1).
  4. Token budget and cost tracking apply (A2, A6); external latency and failures handled
     (A4-style).
- **Data / API changes**: a connected-MCP-servers table + encrypted credential storage;
  tool-retrieval index extension; significant settings UI.
- **Dependencies**: hard-gated behind all of A; benefits from E1 (policies), C (so external
  results get provenance), J (observability of external calls).
- **Risks**: large attack surface (untrusted external tool descriptions are a prompt-injection
  vector, honor the injection-defense rules: external tool outputs are untrusted data and must
  not be treated as instructions); reliability of third-party servers; credential security.
- **Acceptance criteria**: a user connects a sandbox MCP server; its read tools work in a
  turn; its write tools route through the approval gate; everything is tracked and budgeted;
  external tool output cannot redirect the agent without user confirmation.
- **Out of scope**: an MCP server marketplace; non-MCP bespoke connectors.

---

# EPIC H: Sprint chat layout

The bug surfaced by walking sprint mode live: the inline Focus-card chat is unusable.

## H1. Fix sprint Focus-card chat height starvation

- **Surface**: sprint Focus-card chat (inline). **Layer**: Frontend-Functional + Frontend-Polish. **Severity**: High (surface unusable).
- **Problem**: in a live active sprint, the inline Focus-card conversation viewport measured
  **45px** while holding **~5,016px** of content, so the user sees about two lines and must
  scroll within a slit. The fullscreen (Expand) path measured **485px** and is perfectly
  usable. Root cause is height starvation, not an overflow conflict: `Conversation` is
  `flex-1 overflow-y-hidden` with no `min-h`, nested under `CanvasShell`'s `overflow-y-auto`
  wrapper, competing with several fixed rows (tab strip, Expand-button row, ModeToggle row,
  plan banner, two-line composer) inside a short slot. (Correction to an earlier guess: there
  is no duplicated Plan/Act toggle; the extra row is the Expand button stacked on top of the
  single ModeToggle.)
- **Evidence**: measured live (45px vs 485px, same ~5000px content). `conversation.tsx:15`
  `relative flex-1 overflow-y-hidden` (no min-h); `canvas-shell.tsx:144`
  `flex-1 min-h-0 overflow-y-auto p-3`; chain through `focus-card.tsx:47/80`,
  `chat-tab.tsx:55/56-68/69`, `thread-view.tsx:476-483/590/595`;
  `sprint-active-mode-multi.tsx:1775` slot body `flex flex-1 min-h-0 overflow-hidden`.
- **Why it matters**: sprint mode is a core focus surface; the chat there is currently
  unusable, and the user flagged it directly.
- **Target state**: the inline sprint chat gives the conversation a usable height (a floor),
  or defaults to a chat-first layout in the slot.
- **Implementation approach** (pick one, in order of isolation):
  1. Preferred: floor the embedded log height only in the cramped embed. In
     `chat-tab.tsx:69`, change the slot wrapper to guarantee the `role="log"` Conversation a
     usable height, e.g. `[&_[role=log]]:min-h-[220px]`, without touching the fullscreen path
     (which already gets ~485px from `max-h-[calc(100vh-3rem)]`).
  2. Reduce competing chrome: make the Expand-button row an absolute top-right overlay rather
     than a stacked flex row (`chat-tab.tsx:56-68`), returning ~28px to the conversation.
  3. Structural: in very short slots, default to the fullscreen chat treatment
     (`expandThread(key)` on mount when the slot is below a height threshold). Higher
     behavior-change risk; only if product wants chat-first slots.
  4. Add `min-h-0` to `conversation.tsx:15` regardless (lets the flex item behave correctly),
     but note this alone does not add height; the floor in step 1 is the actual fix.
- **Dependencies**: independent; pairs with I (polish) since the embed chrome is also a
  polish concern.
- **Risks**: changing `conversation.tsx` affects every thread surface; prefer the
  embed-scoped fix (step 1) so Spotlight/item-thread are untouched. Sprint pages have a
  documented layering doctrine (AGENTS.md), so verify no z-index/overflow regression and
  regenerate visual baselines.
- **Acceptance criteria**:
  - In an active multi-active sprint, the inline Focus-card conversation viewport is at least
    ~220px and scrolls normally.
  - The fullscreen Expand path is unchanged.
  - Visual baselines for the sprint page are regenerated and pass.
- **Out of scope**: redesigning the whole Focus card.

---

# EPIC I: Design-system adoption / polish

The agent surface is the one place in the app that opts out of the Mashi design system.
Measured across the live thread: message bubbles and tool cards carry `transition: all 0s`;
no `mashi-magnetic`, `mashi-lift`, or `mashi-glow-focus` anywhere in the dialog; the only
motion is the send button's `transform 0.1s` (baked `mashi-press`) plus the Radix Dialog
enter. The rest of Mashi lifts, glows, and rotates on hover; the agent thread is flat. Most
of these are className-level changes using utilities and primitives that already exist, so
they are low-effort and disproportionately raise perceived quality. All motion must go
through `DUR`/`EASE` + `withMotion` (respecting `prefers-reduced-motion`) per AGENTS.md.

## I1. Animate tool cards + hover + chevron (highest craft ROI)

- **Surface**: all threads. **Layer**: Frontend-Polish. **Value**: Medium-High. **Effort**: S.
- **Problem**: tool cards are a bespoke disclosure with no motion (`transition: all 0s`) and
  no hover; expanding pops instantly. They are the most repeated element in the thread.
- **Evidence**: measured tool-card row `transition: all 0s`, no hover state.
- **Target state**: tool cards expand/collapse with animated height+opacity, the chevron
  rotates on open, the row lifts on hover like every other clickable row, and cards stagger
  in as they stream.
- **Implementation approach**: move to the shadcn `Collapsible` (or animate the existing
  disclosure via Radix `data-state`) with `DUR.short`/`EASE.out` through `withMotion`; add
  `.mashi-magnetic` to the row; rotate the chevron via a transition; add a small incremental
  entry delay per card as they arrive.
- **Dependencies**: pairs with C2 (readable results).
- **Acceptance criteria**: expand animates; chevron rotates; row lifts on hover;
  reduced-motion users get no animation.

## I2. Message entry motion

- **Surface**: all threads. **Layer**: Frontend-Polish. **Value**: Medium-High. **Effort**: S.
- **Problem**: user and assistant messages blink in with no entry animation
  (`transition: all 0s`). Claude.ai and Cursor both animate message entry; this is table
  stakes.
- **Evidence**: measured message wrapper `transition: all 0s`, no enter animation (the only
  "enter" is the Dialog's).
- **Target state**: messages arrive with a `DUR.base`/`EASE.out` fade + small rise.
- **Implementation approach**: wrap message mount in `withMotion(() => ...)` with a fade +
  ~4px rise; ensure it does not fight the streaming text updates.
- **Acceptance criteria**: messages animate in; reduced-motion users get none; no jank during
  streaming.

## I3. Streaming polish (caret + skeletons + reasoning entry)

- **Surface**: all threads. **Layer**: Frontend-Polish. **Value**: Medium. **Effort**: S.
- **Problem**: streaming reads as "spinner, then a wall of text." There is no caret, no
  skeletons (a `Skeleton` primitive exists but is unused in the agent surface), and the
  "Thinking…" reasoning block does not animate in.
- **Evidence**: spinners only (`thread-view.tsx:494,736`, `composer.tsx:67`, etc.); `Skeleton`
  primitive unused here.
- **Target state**: a blinking caret at the end of streaming text; `Skeleton` placeholders
  for the first tool card / initial load; the reasoning block animates in.
- **Implementation approach**: add a caret element bound to the streaming state; swap the
  bare loaders for `Skeleton` placeholders; animate the reasoning disclosure with
  `withMotion`.
- **Acceptance criteria**: streaming shows a caret; loading shows skeletons not bare spinners.

## I4. Metadata type scale (reasoning trigger, tool labels)

- **Surface**: all threads. **Layer**: Frontend-Polish. **Severity**: Low (token drift). **Effort**: S.
- **Problem**: the "Thought for…" reasoning trigger renders at 16px and tool-card label text
  inherits 16px, where the doctrine wants `text-xs`/`text-[11px]` for metadata. Combined with
  the 16px body (C5), the whole surface "feels big."
- **Evidence**: measured reasoning trigger 16px; tool label row 16px inherited.
- **Target state**: reasoning trigger and tool-card labels render as small metadata
  (`text-xs` or `text-[11px]`).
- **Implementation approach**: set explicit metadata type sizes on those elements; pair with
  C5 so the body and metadata are fixed together.
- **Acceptance criteria**: measured reasoning trigger and tool labels are <= 12px.

## I5. Composer styling (text-sm + focus glow)

- **Surface**: composer. **Layer**: Frontend-Polish. **Value**: Medium. **Effort**: S.
- **Problem**: the composer textarea is 12px (a touch small for the primary input; input copy
  is `text-sm` elsewhere) and gets only the default focus ring, not the primary-CTA treatment.
- **Evidence**: measured composer 12px, radius 6px (on-token), transition-colors only, no
  `mashi-glow-focus`.
- **Target state**: composer input copy at `text-sm`; `.mashi-glow-focus` on focus; the send
  icon gets a subtle motion on dispatch (it already has `.mashi-press`).
- **Implementation approach**: bump the textarea to `text-sm`; add `.mashi-glow-focus`; add a
  small send-icon motion.
- **Acceptance criteria**: composer copy is 14px and the focus state shows the primary glow.

## I6. Real suggestion chips in the Spotlight empty state

- **Surface**: Spotlight empty state. **Layer**: Frontend-Polish + Frontend-Functional. **Value**: Medium. **Effort**: S.
- **Problem**: Spotlight's empty state shows a single italic example sentence, while the
  item-bound thread shows real clickable chips. The entry point should match.
- **Evidence**: live: Spotlight empty state has italic example text only; item thread has
  three chips ("what is this about?", "summarize the last reply", "what should I do here?").
- **Target state**: Spotlight empty state shows real, clickable suggestion chips with
  `.mashi-magnetic`, consistent with the item thread.
- **Implementation approach**: render `Button`/chip components in the Spotlight empty state
  that prefill/submit the composer; reuse the item-thread chip pattern.
- **Acceptance criteria**: Spotlight shows clickable chips that start a turn.

## I7. Translucency consistency (sanctioned surface steps)

- **Surface**: all threads. **Layer**: Frontend-Polish. **Value**: Low-Medium. **Effort**: S.
- **Problem**: the user bubble is opaque `rgb(31,31,35)`; over the ambient album-art ground
  the agent surfaces do not sample the ambient the way `ChromeBar`/`Surface` do, so the
  thread reads as a different material from the rest of the app.
- **Evidence**: measured user bubble bg opaque, not a sanctioned `/N` translucent step.
- **Target state**: agent surfaces use sanctioned translucent steps (e.g. `/80` card) so the
  thread is part of the same glass system, and `pnpm audit:translucency` stays green.
- **Implementation approach**: move bubble/card backgrounds to sanctioned `/N` tokens or wrap
  in the existing `Surface` primitive; add audit carve-outs only with a documented reason.
- **Acceptance criteria**: agent surfaces use sanctioned steps; the translucency audit passes.

## I8. Reasoning ("thinking") block redesign (component identity, not just motion)

- **Surface**: all threads. **Layer**: Frontend-Polish + Frontend-Functional. **Value**: Medium. **Effort**: S-M.
- **Problem**: the reasoning disclosure renders as flat gray prose ("Thinking…"
  then "Thought for a few seconds") with no visual identity, at 16px so it competes
  with the answer, and the collapsed state is undistinguished. I1/I3 add motion to
  it; this brief redesigns the component itself so it stops being bland. Adding
  motion to a flat component gives you a flat component that wiggles; the identity
  has to change too.
- **Evidence**: `reasoning.tsx` (`ReasoningContent` at `reasoning.tsx:227`); measured
  trigger 16px; live: gray text plus a chevron, no glyph, no rail.
- **Why it matters**: the reasoning block appears on nearly every turn; its blandness
  is a big part of why the surface feels lifeless, and its oversized type makes the
  whole thread read heavy.
- **Current behavior**: gray text, spinner, chevron; 16px; no auto-collapse hierarchy.
- **Target state**: a distinct, quiet-but-alive component:
  - An animated sparkle/brain glyph that pulses (or slow-rotates) while thinking.
  - A shimmer on the streaming narration text (confirm/extend the existing shimmer).
  - A thin left accent rail that visually separates reasoning from the answer.
  - On completion, auto-collapses to small muted metadata ("Thought for 4s",
    `text-xs`, `muted-foreground`) so it de-emphasizes once the answer lands.
  - Expand/collapse animates via `withMotion` + `DUR.short`.
- **Implementation approach**: redesign `reasoning.tsx`: add the glyph with a
  `withMotion` pulse bound to the streaming state; add/verify the shimmer; add the
  accent-rail container; drop the type to `text-xs` metadata (ties to I4 and C5);
  auto-collapse on stream end. Reduced-motion short-circuits the pulse/shimmer.
- **Dependencies**: I3 (streaming polish), I4 (metadata type), C5 (body type).
- **Acceptance criteria**: while thinking, the block is visibly alive and distinct
  from the answer; once done it is quiet metadata that does not compete; measured
  type is <= 12px; reduced-motion users get a static version.

## I9. Tool-call card identity redesign

- **Surface**: all threads. **Layer**: Frontend-Polish + Frontend-Functional. **Value**: Medium-High. **Effort**: M.
- **Problem**: tool cards are flat bordered rows showing the raw `snake_case` tool
  name, a plain "Completed" badge, and a chevron to raw JSON. They are bland and
  low-information: every card looks identical, and you cannot tell what happened
  without expanding. This is the single most-repeated element in a turn, so its
  blandness defines the feel. I1 adds expand/hover motion; this brief redesigns the
  card so it actually communicates.
- **Evidence**: `tool.tsx` (`tool.tsx:22-24` dropped the shiki block; raw `<pre>` at
  `:126/:157`); live: `resolve_reference`, `whoami`, `search_board` rows with a
  generic icon and a plain badge; raw JSON inside.
- **Why it matters**: for a chief-of-staff agent the tool cards are the visible
  evidence of what the agent did; they should read as meaningful, alive steps, and
  they are the highest-leverage component for perceived quality.
- **Current behavior**: identical flat rows, raw tool name, plain badge, instant
  expand to raw JSON, opaque fill, no motion.
- **Target state**: each tool call reads as a meaningful step at a glance:
  - **Per-tool iconography**: map each tool to a meaningful lucide icon (search →
    `Search`, email → `Mail`, calendar → `Calendar`, slack → `MessageSquare`, linear
    → issue glyph, board → `Kanban`, memory → `Brain`, etc.) instead of one generic
    wrench.
  - **Human-readable label**: "Searched the board", "Drafted an email to Sidd",
    "Looked up your calendar"; demote the raw `snake_case` name to mono secondary,
    shown on expand.
  - **Outcome summary in the collapsed state**: "12 results", "found MASH-1130",
    "no matches" (shared extraction with C2), so the card conveys the result without
    expanding.
  - **Status as an animated state machine**: Running (pulsing icon + indeterminate
    bar), Completed (check with a settle animation), Error (red alert); animate the
    Running -> Completed transition.
  - **Motion**: hover lift via `.mashi-magnetic`, chevron rotate, animated height
    expand (this is the I1 layer, applied here).
  - **Sequence treatment**: when a turn fires several tools, connect them with a
    vertical rail/timeline so they read as one sequence, not loose boxes.
  - **Surface**: a sanctioned `/N` step or the `Surface` primitive, not the current
    opaque fill (ties to I7).
- **Implementation approach**: redesign `tool.tsx`: a `tool -> { icon, label }` map;
  a status state machine with `withMotion` transitions; a per-known-tool summary
  extractor (shared with C2, fall back to a generic count for unknown shapes); a
  rail/timeline wrapper in `thread-view.tsx` for grouped calls; move backgrounds to a
  sanctioned step. Keep a "view raw" disclosure for debugging (C2).
- **Data / API changes**: none required; richer summaries benefit from read tools
  returning a small structured descriptor (overlaps C1/C2).
- **Dependencies**: C1 (sources), C2 (readable results / summaries), I1 (motion),
  I7 (translucency).
- **Risks**: the tool -> label/icon map must stay in sync as tools are added; add a
  default (generic icon + humanized name) so an unmapped tool degrades gracefully,
  and a test that every registry tool has a mapping or hits the default.
- **Acceptance criteria**:
  - A glance at a tool card tells you which tool ran, what it did, and the outcome,
    without expanding.
  - Running, Completed, and Error are visually and motionally distinct.
  - Multiple tool calls in a turn read as a connected sequence.
  - An unmapped tool renders with a sensible default, not a crash.

---

# EPIC J: Observability and accessibility

## J1. Make the usage view see agent cost (depends on A2)

- **Surface**: settings/usage. **Layer**: Backend + Frontend. **Value**: Medium. **Effort**: S (after A2).
- **Problem**: today the usage view omits interactive agent cost (A2). Once A2 lands, the
  view should surface agent spend meaningfully (per day, per thread, per purpose).
- **Target state**: usage view shows agent turn cost broken down usefully.
- **Implementation approach**: extend the usage queries/UI to include the new `agent:turn`
  purpose; add a per-thread cost readout if useful.
- **Dependencies**: A2 (hard).
- **Acceptance criteria**: the usage view reflects interactive agent cost after A2.

## J2. Cross-thread tool-call timeline / activity feed

- **Surface**: a new observability surface. **Layer**: Frontend + Backend. **Value**: Medium. **Effort**: M.
- **Problem**: tool activity is visible only per-thread as cards; there is no cross-thread
  feed of what the agent did (especially relevant once G1 scheduled runs and G2 external
  tools exist).
- **Target state**: a feed of recent agent actions across threads (read vs write, tool, time,
  outcome, link to thread), filterable.
- **Implementation approach**: the hook layer already logs tool calls; surface that log in a
  feed view scoped by `user_id`.
- **Dependencies**: most valuable after G1/G2.
- **Acceptance criteria**: a feed lists recent tool calls across threads with links.

## J3. Replay / debug a turn

- **Surface**: an internal/debug surface. **Layer**: Backend + Frontend. **Value**: Low-Medium. **Effort**: M.
- **Problem**: there is no way to inspect the exact context/messages a turn ran with or to
  replay it, which makes debugging corruption (A1) and bad outputs hard.
- **Target state**: an internal view of a turn's reconstructed message list, tool calls, and
  result, with a re-run option (overlaps D2).
- **Implementation approach**: expose `messagesToReplay` output + tool I/O for a turn behind
  an internal flag; reuse D2's re-run path.
- **Dependencies**: A1 (clean replay), D2 (re-run).
- **Acceptance criteria**: an internal user can inspect and re-run a turn's context.

## J4. Accessibility: streaming announcements and error roles

- **Surface**: all threads. **Layer**: Frontend-Functional. **Severity**: Medium (a11y). **Effort**: S.
- **Problem**: the `Conversation` has `role="log"` (so streamed text is announced), but the
  "Thinking…" indicator has no `aria-busy`/status role (SR users get no distinct "in progress"
  cue) and the error banner is a plain div with no `role="alert"` (failures may go
  unannounced).
- **Evidence**: `conversation.tsx:18` `role="log"`; `thread-view.tsx:735` thinking indicator
  no status role; `thread-view.tsx:570-574` error banner no `role="alert"`.
- **Target state**: streaming/in-progress state is announced distinctly; errors are announced
  assertively.
- **Implementation approach**: add `aria-busy`/a status role to the thinking indicator; add
  `role="alert"` to the error banner; verify the `role="log"` politeness is appropriate.
- **Acceptance criteria**: a screen reader announces "in progress" and announces errors.

## J5. Skeletons over spinners (load states)

- **Surface**: all threads + Spotlight. **Layer**: Frontend-Polish. **Value**: Low-Medium. **Effort**: S.
- **Problem**: agent surfaces use spinners only; an unused `Skeleton` primitive exists.
  (Overlaps I3; listed here for the load-state completeness lens.)
- **Target state**: thread load and initial tool cards use skeletons.
- **Implementation approach**: replace the relevant loaders with `Skeleton`.
- **Dependencies**: I3.
- **Acceptance criteria**: thread load shows skeletons.

---

# EPIC K: Perceived smoothness / feel parity

This epic is what makes the difference between "polished and consistent" (Epics C, H, I)
and "feels like Claude.ai / Basedash." Epics I/I8/I9 give the surface a design identity
and motion; this epic governs how it *feels in motion* during the live, streaming,
interruptible reality of an agent turn. Without it, the surface can be on-token and still
feel janky. The explicit target is parity with state-of-the-art agentic interfaces
(Claude.ai for the conversation/streaming feel, Basedash for the snappy, keyboard-driven,
zero-latency interaction feel). These items are cross-cutting and apply to every thread
surface (Spotlight, item thread, sprint chat).

## K1. Streaming cadence smoothing (the biggest "feels like Claude" factor)

- **Surface**: all threads. **Layer**: Frontend-Functional. **Value**: High. **Effort**: M.
- **Problem**: Anthropic SSE deltas arrive in irregular bursts. Rendering them as they
  land makes text appear in lurches, the opposite of Claude's smooth, steady reveal. The
  current loop forwards deltas straight to the UI with no pacing.
- **Evidence**: `streamAgentTurn` (`thread-view.tsx:270-332`) appends deltas directly; no
  buffer or rAF pacing anywhere.
- **Why it matters**: streaming cadence is the dominant signal of "this feels like a
  premium agent." Bursty text reads as cheap regardless of how polished the components are.
- **Target state**: deltas are buffered and revealed at a smooth, steady rate
  (character- or word-level) via `requestAnimationFrame`, catching up gracefully when the
  buffer is large (speed up, never freeze) and finishing promptly when the stream ends.
- **Implementation approach**: introduce a client-side reveal buffer between the SSE
  reader and the rendered text; a rAF loop drains it at an adaptive rate (rate scales with
  backlog so it never lags far behind, but never dumps); flush immediately on stream
  completion and on Stop (A3). Keep the caret (I3) bound to the reveal head.
- **Dependencies**: A3 (Stop must flush cleanly), I3 (caret).
- **Risks**: over-smoothing adds perceived latency; tune so the reveal stays within a small
  bounded lag of the actual stream and accelerates under backlog.
- **Acceptance criteria**: side-by-side with Claude.ai, Mashi's text reveal looks
  comparably smooth (no visible lurching) at both fast and slow generation speeds; Stop
  flushes instantly.

## K2. Zero-jank auto-scroll and layout stability

- **Surface**: all threads. **Layer**: Frontend-Functional. **Value**: High. **Effort**: M.
- **Problem**: as text streams and tool cards appear, content can jump and the scroll
  position can fight the user. Smooth agent UIs pin to the bottom during streaming, release
  the pin the moment the user scrolls up, and reserve space so appearing elements do not
  shove content.
- **Evidence**: no smart-scroll logic in `thread-view.tsx`; tool cards mount inline
  (`thread-view.tsx:649`) and can shift the answer.
- **Target state**: during streaming the view stays pinned to the bottom smoothly; if the
  user scrolls up, the pin releases and a "jump to latest" affordance appears; appearing
  tool cards and reasoning blocks do not cause layout jumps (reserve/animate space).
- **Implementation approach**: a scroll controller that tracks "is the user at bottom,"
  auto-scrolls on new content only when pinned, and uses scroll anchoring / reserved space
  for mounting elements; a "jump to latest" button when unpinned. Animate scroll with eased
  behavior, not instant jumps.
- **Dependencies**: I1/I9 (so mounting cards have known/animated sizes), K1.
- **Acceptance criteria**: streaming never yanks the scroll while the user is reading
  above; appearing tool cards do not shift the text the user is reading; returning to bottom
  is one smooth action.

## K3. Motion performance budget (60fps, GPU-only, correct expand technique)

- **Surface**: all threads. **Layer**: Frontend-Polish + Frontend-Functional. **Severity**: Medium (corrects I1/I9).
- **Problem**: several briefs say "animate height" (I1, I9). Animating layout properties
  (height/top/margin) triggers layout/paint and janks. State-of-the-art interfaces animate
  only transform and opacity (GPU-composited) and expand via a grid-rows / clip / FLIP
  technique, holding 60fps. This brief sets the performance rule and corrects the technique
  in I1/I9.
- **Evidence**: I1/I9 as written specify height animation; no performance budget exists in
  the motion doctrine (AGENTS.md polish section enforces *which* utility, not frame cost).
- **Target state**: all agent-surface animation is transform/opacity (and `clip-path` or the
  `grid-template-rows: 0fr -> 1fr` trick for expand), holds 60fps on a mid-tier laptop, and
  never animates a layout-triggering property. This becomes a line in the AGENTS.md motion
  doctrine and part of `audit:motion`'s intent.
- **Implementation approach**: replace height tweens in the tool-card and reasoning expand
  with the grid-rows or clip technique; verify with devtools performance traces (no long
  layout/paint during animation); add a note to AGENTS.md and, if feasible, a lint/audit
  hint flagging animated `height`/`top`/`margin` on agent components.
- **Dependencies**: corrects I1, I8, I9; pairs with the `audit:motion` work.
- **Acceptance criteria**: a devtools trace of expanding a tool card and a streaming turn
  shows sustained ~60fps with no layout thrash; no agent animation targets a
  layout-triggering property.

## K4. Instant feedback / optimistic interaction

- **Surface**: composer + all threads. **Layer**: Frontend-Functional. **Value**: Medium-High. **Effort**: S-M.
- **Problem**: premium agent UIs feel instant: the composer clears the moment you send, the
  user message and a thinking state appear immediately, before any server round-trip. Any
  perceptible gap between pressing Enter and visible feedback reads as sluggish (Basedash's
  whole feel is built on this).
- **Evidence**: current send path waits on the request to begin rendering; composer is
  merely disabled (`composer.tsx`), not optimistically cleared with an immediate echo.
- **Target state**: pressing send instantly clears the composer, renders the user message,
  and shows the thinking state with no perceptible delay; failures reconcile gracefully
  (the message stays, an error/retry appears) rather than the input feeling laggy.
- **Implementation approach**: optimistic render of the user turn and thinking state on
  submit; reconcile with server state when it arrives; on failure keep the optimistic
  message and surface retry (ties to A4/D2). Ensure the textarea autosizes without jank.
- **Dependencies**: A1 (turn lock so optimistic + server agree), A4/D2 (failure reconcile).
- **Acceptance criteria**: from Enter to visible user message + thinking state is
  imperceptible (<100ms); a failed send leaves the message with a retry, never a dead lag.

## K5. Feel-parity acceptance gate (the actual bar)

- **Surface**: all threads. **Layer**: process / QA. **Value**: High (this is how we hold the bar). **Effort**: S (recurring).
- **Problem**: "feels as smooth as Claude/Basedash" cannot be asserted from a checklist; it
  has to be reviewed against the reference apps. Without an explicit gate, the epic can ship
  technically-complete and still feel a notch off.
- **Target state**: a required feel review before Epic K (and I8/I9) is considered done,
  benchmarking specific dimensions against Claude.ai and Basedash.
- **Implementation approach**: a short scripted feel review comparing, side by side:
  streaming smoothness (K1), scroll behavior while reading (K2), expand/entry/state motion
  at 60fps (K3, I1, I8, I9), send-to-feedback latency (K4), interruption/Stop smoothness
  (A3), and consistency across Spotlight / item thread / sprint chat. Capture a screen
  recording per dimension. Anything that reads as a notch below the reference is a bounce,
  with the specific gap logged. Optionally capture frame timings to make "60fps" objective.
- **Dependencies**: all of K, plus I1/I8/I9, A3.
- **Acceptance criteria**: a reviewer, shown Mashi and the reference app side by side
  without labels, cannot reliably pick which is "the less smooth one" on each dimension; any
  dimension that fails is logged and fixed before sign-off.

---

# EPIC L: Next-generation experience

This is the north-star epic (see "North star" at the top). It reframes the agent surface
from a transcript into a workspace. It is deliberately phased: Phase 1 makes the existing
surface feel alive and actionable on top of Epics I and K; Phase 2 builds the native
artifact canvas. All of it sits on Epic A. Phase 2 also depends on Epic G (scheduling) for
the proactivity piece. These are large; each brief here is a candidate to split into
multiple story-level specs.

## Phase 1: aliveness and action (on top of Epics I + K)

### L1. Interactive / generative tool-result components

- **Surface**: all threads. **Layer**: Frontend-Functional + Feature-Tool. **Value**: High. **Effort**: M-L.
- **Problem**: tool results are dead, read-only JSON disclosures. I9 makes them look
  alive; L1 makes them *be* actionable. This is the direct answer to "the components are
  dead."
- **Target state**: results render as control surfaces. `search_board` -> a live list with
  inline snooze / open / assign; `list_today` -> an interactive checklist; a calendar read
  -> a mini calendar; **plan mode -> a live checklist that checks itself off as the agent
  executes each step**, so the user watches work happen rather than reading about it.
- **Implementation approach**: a result-type -> component registry; components issue
  ring-aware actions through the existing tool + approval pipeline (so inline actions are
  governed exactly like typed ones); plan execution emits step-progress events the
  checklist consumes. Fall back to the I9 readable card for unmapped result types.
- **Dependencies**: A (loop), E (approval pipeline for inline actions), C2 (typed result
  shapes), I9 (card identity).
- **Acceptance criteria**: from a tool result the user takes an action inline without
  typing; in plan mode, steps visibly check off during execution; an unmapped result still
  renders well.

### L2. Slash commands + keyboard-first interaction model

- **Surface**: composer + all threads. **Layer**: Frontend-Functional. **Value**: High. **Effort**: M.
- **Problem**: the composer is prose-only and interaction is mouse-driven; there is no fast
  intent path. State-of-the-art interfaces (Basedash) are keyboard-first and snappy.
- **Target state**: slash commands (`/draft`, `/brief`, `/schedule`, `/find`, ...) as a
  composer typeahead; a keyboard model over the thread (arrow to navigate tool results,
  Enter to act, one-key approve, quick-undo, escape semantics), complementing ⌘K.
- **Implementation approach**: a command registry surfaced as a typeahead (shares the
  mechanism with B2 @-mentions); a roving-focus/shortcut layer over the thread and results.
- **Dependencies**: B2 (shared typeahead), L1 (actionable results to navigate).
- **Acceptance criteria**: a power user drives a full turn (intent -> review -> approve)
  without the mouse.

### L3. Contextual quick-action chips

- **Surface**: all threads. **Layer**: Frontend-Functional + Feature-Tool. **Value**: Medium. **Effort**: S-M.
- **Problem**: after a turn, the next move requires typing.
- **Target state**: contextual chips after a turn ("Send it", "Snooze a week", "Add to
  sprint", "Draft a reply") derived from the turn's context, one tap to act.
- **Implementation approach**: the loop emits structured suggested follow-up actions; the
  UI renders them as chips wired to tools (ring-gated through the approval pipeline).
- **Dependencies**: L1, E.
- **Acceptance criteria**: common next actions appear as chips and execute in one tap with
  the normal safety gates.

### L4. Live tool narration + presence

- **Surface**: all threads. **Layer**: Frontend-Functional. **Value**: Medium-High. **Effort**: M.
- **Problem**: a silent spinner; the agent does not feel present.
- **Target state**: live human narration of what the agent is doing ("Reading 3 Slack
  threads...", "Checking your calendar..."), bound to the expressive thinking block (I8),
  plus visible memory accrual ("I'll remember that", F1) and presence micro-animations.
- **Implementation approach**: emit a human narration string per tool start; render it in
  the I8 reasoning block / tool card; small presence animations on the agent glyph.
- **Dependencies**: I8 (reasoning redesign), K1 (cadence), F1 (memory moment).
- **Acceptance criteria**: during a turn the user sees, in human terms and live, what the
  agent is doing, not a generic spinner.

## Phase 2: the native artifact workspace (gated behind A; proactivity behind G)

### L5. Native artifact runtime

- **Surface**: all threads. **Layer**: Backend + Frontend-Functional + Feature-Tool. **Value**: High (the big bet). **Effort**: XL (phase-sized).
- **Problem**: substantial outputs are text blobs; there are no editable, versioned,
  exportable objects in the chat. Decision: build the runtime native to the agent surface,
  not on the Skills/Cowork layer.
- **Target state**: the loop emits artifact blocks; the UI renders them as live objects with
  render, inline edit, version history, export, and dispatch. Chief-of-staff artifact types:
  email/Slack draft, brief/memo (doc), table (pipeline/leads/deals), schedule/calendar
  proposal, decision record. v1 scope: keep to 2-3 types (draft + brief + table).
- **Implementation approach**: a new artifact content-block type in the loop's message model
  (alongside text/tool_use/tool_result); an artifact + artifact_versions persistence model
  tied to thread/item with owner-only RLS; a renderer registry per artifact type; export
  adapters that reuse the Skills docx/pptx/xlsx/pdf generators as *export targets* while the
  in-chat runtime stays native; dispatch (send/save/push) routes through the ring-3 approval
  pipeline.
- **Data / API changes**: artifact + version tables + additive migration; loop message-block
  extension; export storage (shares B1 storage patterns).
- **Dependencies**: A (hard), B1 (storage), E (dispatch through approval), C2 (typed data).
- **Risks**: phase-sized scope creep; hold v1 to draft + brief + table and a single export
  format before expanding. Versioning and concurrent edit (user editing while agent
  regenerates) need a clear model, reuse the A1 lock discipline.
- **Acceptance criteria**: the agent produces an editable brief artifact; the user edits it,
  sees version history, exports to pdf/docx, and it persists with the item; dispatch goes
  through the approval gate.

### L6. Split-canvas workspace layout

- **Surface**: all threads. **Layer**: Frontend-Functional + Frontend-Polish. **Value**: Medium-High. **Effort**: M-L.
- **Problem**: a single-column transcript cannot hold a persistent artifact plus pinned
  context.
- **Target state**: thread on one side, persistent artifact/canvas on the other, pinned item
  context always visible; degrades gracefully to a sheet on narrow (ties to H and the mobile
  findings).
- **Implementation approach**: a responsive split layout in the thread surface honoring the
  layout doctrine (z-scale, primitives, `FocusOverlay` for fullscreen, `Resizable` from
  shadcn for the split); reuse the H lessons about height and overflow.
- **Dependencies**: L5, H (sprint embed height lessons), I7 (translucency).
- **Acceptance criteria**: an artifact stays visible and editable beside the conversation;
  narrow viewports collapse to a sheet without the H-class height bug.

### L7. Approval-as-artifact (fold the modal into the canvas)

- **Surface**: approval flow + canvas. **Layer**: Frontend-Functional + Feature-Tool. **Value**: High. **Effort**: M.
- **Problem**: the approval modal (Epic E) is a transient separate surface. In a workspace, a
  draft *is* an artifact you edit and then dispatch; the modal is the wrong shape.
- **Target state**: ring-3 drafts render as editable artifacts (L5) with the dispatch action
  on the artifact itself; the diff (E2), per-tool policy (E1), and recall (E4) live on the
  artifact. "Approve" becomes "Send" on the thing you just edited.
- **Implementation approach**: unify the approval-card and artifact paths so draft_email /
  send_slack_message produce an artifact whose primary action is the gated dispatch; carry
  E1/E2/E4 onto it.
- **Dependencies**: L5, E1/E2/E4.
- **Acceptance criteria**: drafting and sending an email happens in one editable artifact,
  not a popup, with diff, policy, and recall all present.

### L8. Proactivity / presence across time

- **Surface**: a presence/inbox surface + threads. **Layer**: Feature-Tool + Backend. **Value**: High. **Effort**: L.
- **Problem**: the agent is purely reactive; nothing makes it feel alive between sessions.
- **Target state**: "while you were away" summaries, proactive nudges the agent surfaces on
  its own, and scheduled briefs (G1) delivered as artifacts (L5) into a presence surface. The
  agent proposes; it never acts unattended without an explicit scoped policy (E1).
- **Implementation approach**: builds on G1 (scheduled runs) plus a notifications/inbox
  surface; proactive suggestions are generated and surfaced for one-tap action or dismissal.
- **Dependencies**: G1 (hard), E1 (any unattended action), L5 (briefs as artifacts).
- **Acceptance criteria**: a scheduled brief appears as an artifact the user opens; the agent
  surfaces a proactive nudge the user can act on or dismiss; nothing world-writes unattended
  without policy.

---

# Sequencing summary (for sprint planning)

This is a suggested order, not a commitment. Rationale: foundation first (so nothing leaks or
corrupts), then the daily-use capability and trust surfaces, then the higher-ceiling phases
that depend on the foundation.

1. **Sprint 1 (foundation):** A1 (turn lock), A2 (tracked streaming), A3 (cancellation + Stop),
   A8 (partial-text), A7 (pricing guard). H1 (sprint chat fix) and C5 + I4 (type scale) can ride
   along since they are isolated and high-visibility (the user-flagged items).
2. **Sprint 2 (control + resilience):** A4 (retry/reconnect), A5 (approval poll), A6 (budget),
   A9 (max_tokens), D2 (regenerate), D3 (edit-resend).
3. **Sprint 3 (input + trust):** B1 (image/file), C1 (sources), C2 (readable tool results),
   C3 (copy), C4 (code/dead-deps decision).
4. **Sprint 4 (approvals + polish + feel):** E1 (per-tool policy), E2 (diff), E3 (card weight +
   body + nested args), E4 (recall/undo), E5 (ring review); I1-I9 polish including I8/I9
   (reasoning + tool-card redesign); K1-K4 (streaming cadence, zero-jank scroll, 60fps motion
   budget, instant feedback) with K3 correcting the "animate height" instruction in I1/I8/I9;
   D4 (export + search); J4 (a11y), J5/J1 (skeletons + usage view). Close the sprint with K5
   (feel-parity gate) before sign-off; do not call the agent surface done until it passes.
5. **Phase (higher ceiling, gated behind 1-2):** F1 (proposed memory), F2 (playbooks),
   G1 (scheduled runs), F3 (subagents), J2 (timeline), G2 (MCP client, behind a flag), J3 (replay).
6. **Experience phase 1 (aliveness, on top of Epics I + K):** L1 (interactive tool
   components), L2 (slash commands + keyboard-first), L3 (quick-action chips), L4 (live
   narration + presence). This is the near-term path to "feels alive" and is the natural
   follow-on to the polish + smoothness sprint.
7. **Experience phase 2 (next-gen workspace, gated behind A, and G for proactivity):** L5
   (native artifact runtime, v1 = draft + brief + table), L6 (split-canvas), L7
   (approval-as-artifact, folds Epic E into the canvas), L8 (proactivity/presence, on G1).
   This is the multi-quarter bet, not a single sprint; scope L5 tightly for v1.

Note: Epics A through K take the *current* experience from broken/bland to polished,
smooth, and trustworthy. Epic L is the reframe to a next-generation workspace. Do not start
L until A is done; do not start Phase 2 of L until the Phase 1 aliveness work and G1 exist.

# Cross-cutting acceptance themes

- No agent change ships without respecting the multi-tenancy invariants (every new table
  owner-only RLS, service-role paths set `user_id`).
- New migrations are additive and idempotent per AGENTS.md.
- Any change to a dashboard/sprint page regenerates visual baselines.
- All motion goes through `DUR`/`EASE` + `withMotion` and respects reduced-motion.
- Interactive primitives come from `src/components/ui/` (shadcn-first); no new hand-rolled
  modals/dropdowns/toasts.
- External/tool/document content is untrusted data: it is never executed as instructions; any
  action it implies requires explicit user confirmation (injection-defense doctrine), which is
  especially load-bearing for B1 (file content) and G2 (external MCP tools).
