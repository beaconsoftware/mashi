/**
 * L3 (P6.c.b) — contextual quick-action chips, pure derivation.
 *
 * After a turn settles, the next move usually means typing again. This derives
 * a few contextual chips ("Send it", "What's most urgent?", "Add to sprint")
 * from what the turn just *did* — the tools it called and whether it surfaced
 * board items — so the common next step is one tap away.
 *
 * Like the L1 inline actions, a chip never calls a tool directly: its `prompt`
 * is dispatched through the normal `send` pipeline, so every ring + approval
 * gate still applies (a "Send it" chip that resolves to a ring-3 send still
 * pauses for approval). The shape-knowledge of *which* tools imply *which* next
 * moves lives here, pure and unit-tested (`__tests__/quick-actions.test.ts`);
 * the component only walks the message list to gather the signals and renders.
 *
 * Scoping note: the brief floats a loop-emitted "suggested follow-up actions"
 * channel. That is deferred — it would mean a new delta + protocol surface, the
 * same loop change P6.c.a chose not to invent. Deriving from the turn's tool
 * signals client-side covers the acceptance criteria with no migration and no
 * loop change, and the derivation can be swapped for a server signal later
 * without touching the chip UI.
 */

export type QuickActionIconKey =
  | "send"
  | "tone"
  | "urgent"
  | "plan"
  | "sprint"
  | "snooze"
  | "done"
  | "reply"
  | "step";

export interface QuickAction {
  /** Stable id, also the React key. Unique within a returned set. */
  id: string;
  label: string;
  /** The natural-language turn the chip dispatches through `send`. */
  prompt: string;
  icon: QuickActionIconKey;
}

/** The signals a turn leaves behind, gathered by the component from the
 * messages since the last user turn. */
export interface TurnSignals {
  /** Names of every tool the turn called (in order, may repeat). */
  toolNames: string[];
  /** How many actionable board items the turn surfaced (0 when none). */
  itemCount: number;
}

const CHIP_CAP = 4;

/**
 * Derive the contextual chips for a settled turn. Returns [] when nothing
 * confident applies — an empty set renders no chip row rather than guessing.
 */
export function deriveQuickActions(signals: TurnSignals): QuickAction[] {
  const names = new Set(signals.toolNames);
  const out: QuickAction[] = [];
  const push = (a: QuickAction) => {
    if (!out.some((x) => x.id === a.id)) out.push(a);
  };

  // A draft was produced → the natural next steps are to send or tweak it.
  if (names.has("draft_email")) {
    push({
      id: "send-draft",
      label: "Send it",
      prompt: "Send that draft.",
      icon: "send",
    });
    push({
      id: "tone-draft",
      label: "Adjust the tone",
      prompt: "Make that draft warmer and a little more concise.",
      icon: "tone",
    });
  }

  // A board read that surfaced items → triage moves over the list.
  const surfacedList =
    signals.itemCount > 0 &&
    (names.has("search_board") ||
      names.has("list_today") ||
      names.has("get_today"));
  if (surfacedList) {
    push({
      id: "most-urgent",
      label: "What's most urgent?",
      prompt: "Of these, what needs my attention first and why?",
      icon: "urgent",
    });
    push({
      id: "plan-day",
      label: "Plan my day",
      prompt: "Build a plan for my day from these.",
      icon: "plan",
    });
  }

  // A single item was fetched → act on that one item.
  if (names.has("get_item")) {
    push({
      id: "snooze-item",
      label: "Snooze a week",
      prompt: "Snooze that item for a week.",
      icon: "snooze",
    });
    push({
      id: "done-item",
      label: "Mark it done",
      prompt: "Mark that item as done.",
      icon: "done",
    });
  }

  // A message/thread was read → offer to reply.
  if (names.has("get_message_thread") || names.has("search_messages")) {
    push({
      id: "draft-reply",
      label: "Draft a reply",
      prompt: "Draft a reply to that.",
      icon: "reply",
    });
  }

  // Something was created → fold it into the active sprint.
  if (names.has("create_item")) {
    push({
      id: "add-sprint",
      label: "Add to sprint",
      prompt: "Add that to my current sprint.",
      icon: "sprint",
    });
  }

  // A plan was laid out → start executing it.
  if (names.has("set_plan")) {
    push({
      id: "start-plan",
      label: "Start step one",
      prompt: "Let's start the first step of the plan.",
      icon: "step",
    });
  }

  return out.slice(0, CHIP_CAP);
}
