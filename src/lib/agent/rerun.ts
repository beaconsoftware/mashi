import type { ToolRing } from "@/lib/agent/types";

/**
 * Pure helpers for Regenerate (D2) and Edit-and-resend (D3).
 *
 * Both features re-run a turn from an earlier user message, which means
 * discarding the rows that came after it. The two risks the briefs call
 * out are encoded here as pure, unit-tested functions so the route logic
 * stays thin:
 *
 *   - finding the right anchor user message, and
 *   - refusing to discard a segment that already committed a real-world
 *     or board write. P4's recall/undo (E4) isn't merged yet, so the
 *     lower-risk path the D2 brief sanctions is: only re-run turns whose
 *     discarded segment took no write action. A read-only segment is
 *     always safe to throw away.
 *
 * No DB / SDK imports — the registry ring lookup is injected so the
 * module is testable without booting the tool catalogue.
 */

export interface RerunMessageRow {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  seq: number;
  content: string | null;
  tool_calls: Array<{ id: string; name: string; input: unknown }> | null;
  cursor_context?: unknown;
}

/** The last live user message — the anchor Regenerate re-runs from. */
export function findLastUserMessage(
  rows: RerunMessageRow[]
): RerunMessageRow | null {
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    if (rows[i].role === "user") return rows[i];
  }
  return null;
}

/** The user message Edit-and-resend targets, by id. Null if it isn't a
 * live user message in the thread. */
export function findUserMessageById(
  rows: RerunMessageRow[],
  messageId: string
): RerunMessageRow | null {
  const row = rows.find((r) => r.id === messageId);
  return row && row.role === "user" ? row : null;
}

/** Live rows strictly after the anchor (the segment that gets discarded). */
export function rowsAfterSeq(
  rows: RerunMessageRow[],
  afterSeq: number
): RerunMessageRow[] {
  return rows.filter((r) => r.seq > afterSeq);
}

/**
 * The first committed write tool in a segment, or null if the segment is
 * read-only. A "committed write" is any assistant tool_call whose ring is
 * write_mashi or write_world. ring lookup is injected; an unknown tool is
 * treated as non-blocking (it can't have committed a known write).
 */
export function firstCommittedWrite(
  segment: RerunMessageRow[],
  ringOf: (toolName: string) => ToolRing | undefined
): { tool: string } | null {
  for (const row of segment) {
    if (row.role !== "assistant" || !Array.isArray(row.tool_calls)) continue;
    for (const tc of row.tool_calls) {
      const ring = ringOf(tc.name);
      if (ring === "write_mashi" || ring === "write_world") {
        return { tool: tc.name };
      }
    }
  }
  return null;
}

export type RerunGuard =
  | { ok: true; anchor: RerunMessageRow; discarded: RerunMessageRow[] }
  | { ok: false; reason: "no_anchor" | "committed_write"; tool?: string };

/**
 * Resolve the anchor + the segment to discard, and refuse if that segment
 * already committed a write. `target` selects the mode: the last user
 * message (regenerate) or a specific user message id (edit).
 */
export function planRerun(
  rows: RerunMessageRow[],
  target: { mode: "last" } | { mode: "message"; messageId: string },
  ringOf: (toolName: string) => ToolRing | undefined
): RerunGuard {
  const anchor =
    target.mode === "last"
      ? findLastUserMessage(rows)
      : findUserMessageById(rows, target.messageId);
  if (!anchor) return { ok: false, reason: "no_anchor" };
  const discarded = rowsAfterSeq(rows, anchor.seq);
  const write = firstCommittedWrite(discarded, ringOf);
  if (write) return { ok: false, reason: "committed_write", tool: write.tool };
  return { ok: true, anchor, discarded };
}
