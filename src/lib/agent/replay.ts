import type Anthropic from "@anthropic-ai/sdk";
import {
  attachmentToPlaceholderBlock,
  type AttachmentDescriptor,
} from "@/lib/agent/attachments";
import {
  referencesToPromptText,
  sanitizeReferences,
  type AgentReference,
} from "@/lib/agent/references";

/**
 * Turn-replay reconstruction (A1).
 *
 * Pure functions, no DB / SDK side effects, so they're unit-testable in
 * isolation (see `__tests__/replay.test.ts`). `loop.ts` calls
 * `messagesToReplay` to rebuild the Anthropic message list from persisted
 * agent_messages rows before each turn.
 */

export interface ReplayBlock {
  role: "user" | "assistant";
  content: Anthropic.Messages.MessageParam["content"];
}

export function messagesToReplay(
  rows: Array<{
    role: string;
    content: string | null;
    tool_calls: unknown;
    tool_results: unknown;
    /** B1 (P3): attachments on a user row. Emitted as `mashi_ref`
     * placeholder blocks the loop resolves to real image/document
     * blocks before the model call. */
    attachments?: unknown;
    /** B2 (P3): pinned @-mention references on a user row. Prepended to
     * the user message as a short "already resolved" note so the model
     * skips the resolve_reference round-trip. */
    pinned_references?: unknown;
  }>
): ReplayBlock[] {
  // Reconstruct the Anthropic-shaped message list from persisted rows.
  // - role=user  → content text
  // - role=assistant with tool_calls → array of text + tool_use blocks
  // - role=tool                       → user message with tool_result blocks
  // - role=system                     → skip; system prompt is rebuilt fresh
  const out: ReplayBlock[] = [];
  for (const row of rows) {
    if (row.role === "system") continue;
    if (row.role === "user") {
      const attachments = Array.isArray(row.attachments)
        ? (row.attachments as AttachmentDescriptor[])
        : [];
      // B2: prepend a short "pinned references, already resolved" note so
      // the model references the items directly and skips resolve_reference.
      const refs: AgentReference[] = sanitizeReferences(row.pinned_references);
      const refNote = referencesToPromptText(refs);
      const text = row.content && row.content.trim().length > 0 ? row.content : "";
      const body = refNote ? (text ? `${refNote}\n\n${text}` : refNote) : text;
      const hasBody = body.trim().length > 0;
      // B1: a user row can carry attachments with or without a text body.
      // With attachments, emit an array of placeholder blocks (+ a trailing
      // text block when present); with a body only, keep the plain-string
      // form (cheaper + unchanged behavior for the common case).
      if (attachments.length > 0) {
        const blocks: unknown[] = attachments.map(attachmentToPlaceholderBlock);
        if (hasBody) blocks.push({ type: "text", text: body });
        out.push({
          role: "user",
          content: blocks as unknown as ReplayBlock["content"],
        });
      } else if (hasBody) {
        out.push({ role: "user", content: body });
      }
      continue;
    }
    if (row.role === "assistant") {
      const blocks: Array<
        | { type: "text"; text: string }
        | { type: "tool_use"; id: string; name: string; input: unknown }
      > = [];
      if (row.content && row.content.length > 0) {
        blocks.push({ type: "text", text: row.content });
      }
      if (Array.isArray(row.tool_calls)) {
        for (const tc of row.tool_calls as Array<{
          id: string;
          name: string;
          input: unknown;
        }>) {
          blocks.push({
            type: "tool_use",
            id: tc.id,
            name: tc.name,
            input: tc.input,
          });
        }
      }
      if (blocks.length > 0) {
        out.push({
          role: "assistant",
          content: blocks as unknown as ReplayBlock["content"],
        });
      }
      continue;
    }
    if (row.role === "tool") {
      if (!Array.isArray(row.tool_results)) continue;
      const blocks = (row.tool_results as Array<{
        tool_use_id: string;
        content: string;
        is_error?: boolean;
      }>).map((r) => ({
        type: "tool_result" as const,
        tool_use_id: r.tool_use_id,
        content: r.content,
        is_error: r.is_error ?? false,
      }));
      out.push({
        role: "user",
        content: blocks as unknown as ReplayBlock["content"],
      });
    }
  }
  return ensureToolResultsPaired(out);
}

/**
 * A1 defensive replay: Anthropic rejects any assistant `tool_use` block
 * that isn't answered by a matching `tool_result` in the next user turn.
 * A process crash between the assistant-row insert and the tool-result
 * row (or interleaved rows from a concurrent turn) can leave an orphaned
 * tool_use. Rather than let that 400 the next turn forever, synthesize an
 * error tool_result for any unanswered tool_use id. The model already
 * self-corrects on error results, so this turns a wedged thread into a
 * recoverable one.
 */
export function ensureToolResultsPaired(blocks: ReplayBlock[]): ReplayBlock[] {
  const out: ReplayBlock[] = [];
  for (let i = 0; i < blocks.length; i += 1) {
    const cur = blocks[i];
    out.push(cur);
    if (cur.role !== "assistant" || !Array.isArray(cur.content)) continue;

    const toolUseIds = (cur.content as Array<{ type: string; id?: string }>)
      .filter((b) => b.type === "tool_use" && typeof b.id === "string")
      .map((b) => b.id as string);
    if (toolUseIds.length === 0) continue;

    const next = blocks[i + 1];
    const nextIsToolResultMsg =
      !!next &&
      next.role === "user" &&
      Array.isArray(next.content) &&
      (next.content as Array<{ type: string }>).some(
        (b) => b.type === "tool_result"
      );

    const answered = new Set<string>();
    if (nextIsToolResultMsg) {
      for (const b of next.content as Array<{
        type: string;
        tool_use_id?: string;
      }>) {
        if (b.type === "tool_result" && typeof b.tool_use_id === "string") {
          answered.add(b.tool_use_id);
        }
      }
    }

    const missing = toolUseIds.filter((id) => !answered.has(id));
    if (missing.length === 0) continue;

    const synthetic = missing.map((id) => ({
      type: "tool_result" as const,
      tool_use_id: id,
      content: JSON.stringify({
        error:
          "Tool result missing (interrupted turn). Treat this call as failed and continue.",
      }),
      is_error: true,
    }));

    if (nextIsToolResultMsg) {
      // Splice into the existing tool-result message (multiple
      // tool_result blocks in one user turn is valid). The same object
      // is pushed when the loop reaches i+1, so it carries the patch.
      (next.content as unknown[]).push(...synthetic);
    } else {
      // No tool-result turn follows: insert a fresh one right after the
      // assistant message, before whatever (if anything) comes next.
      out.push({
        role: "user",
        content: synthetic as unknown as ReplayBlock["content"],
      });
    }
  }
  return out;
}
