/**
 * L2 (P6.c.b) — keyboard model over the thread, pure decision layer.
 *
 * The thread surface is mouse-driven today: to approve a ring-3 action, undo a
 * ring-2 write, or act on an interactive result, you reach for the pointer.
 * This module decides — from a keystroke plus a snapshot of thread state — what
 * a power user meant, so they can drive a full turn (intent → review → approve)
 * without leaving the keyboard. The thin imperative shell in `thread-view.tsx`
 * carries the intent out to the DOM (focus moves, or a click on the same
 * control a mouse would hit, so no approval/undo logic is duplicated).
 *
 * No React / DOM imports — unit-tested in `__tests__/keyboard.test.ts`.
 *
 * The accelerators are deliberately modifier-gated so they never fight typing:
 *   - ⌘/Ctrl+Enter approves the latest pending approval (plain Enter still
 *     sends from the composer; ⌘/Ctrl+Enter does nothing when none pends).
 *   - ⌘/Ctrl+Z undoes the latest recallable action, but only when the composer
 *     is empty, so native undo-of-typing is untouched while a draft is in hand.
 *   - Arrow up/down rove focus across thread action controls, but only while
 *     such a control already holds focus (so caret movement in the composer is
 *     untouched).
 */

export type ThreadHotkeyIntent =
  | "approve"
  | "undo"
  | "focus-next"
  | "focus-prev"
  | null;

/** The keystroke fields the resolver reads — a structural subset of a
 * KeyboardEvent, so the resolver is trivially testable. */
export interface HotkeyEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** A snapshot of what the thread currently offers the keyboard. */
export interface ThreadHotkeyState {
  /** A ring-3 approval card is awaiting a decision. */
  hasApproval: boolean;
  /** A ring-2 action is inside its recall window. */
  hasRecallableUndo: boolean;
  /** The composer textarea is empty (or unfocused), so ⌘Z is free to undo. */
  composerEmpty: boolean;
  /** Focus is currently on a thread action control (an interactive row button,
   * a quick-action chip, an approve/undo button), so arrows may rove. */
  onActionControl: boolean;
}

/**
 * Map a keystroke + thread state to the user's intent, or null when the
 * keystroke isn't one of our accelerators (the event then proceeds normally).
 */
export function resolveThreadHotkey(
  e: HotkeyEvent,
  state: ThreadHotkeyState
): ThreadHotkeyIntent {
  const mod = e.metaKey || e.ctrlKey;

  // ⌘/Ctrl+Enter → approve the pending action. Shift/Alt opt out so other
  // combos stay available.
  if (mod && !e.shiftKey && !e.altKey && e.key === "Enter") {
    return state.hasApproval ? "approve" : null;
  }

  // ⌘/Ctrl+Z → quick-undo, only with an empty composer so typing's native
  // undo is preserved. Shift+⌘Z (redo) is intentionally left alone.
  if (mod && !e.shiftKey && !e.altKey && (e.key === "z" || e.key === "Z")) {
    return state.hasRecallableUndo && state.composerEmpty ? "undo" : null;
  }

  // Arrow roving — only while an action control holds focus, and only as a
  // bare arrow (no modifiers), so it never hijacks composer caret movement or
  // an open typeahead's own arrow handling.
  if (!mod && !e.shiftKey && !e.altKey && state.onActionControl) {
    if (e.key === "ArrowDown") return "focus-next";
    if (e.key === "ArrowUp") return "focus-prev";
  }

  return null;
}
