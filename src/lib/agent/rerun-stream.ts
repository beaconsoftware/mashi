import { runAgentTurn, type AgentDelta } from "@/lib/agent/loop";
import {
  claimThreadTurn,
  loadLiveMessagesForRerun,
  releaseThreadTurn,
  truncateThreadAfterSeq,
  updateUserMessageContent,
} from "@/lib/agent/threads";
import { planRerun, type RerunMessageRow } from "@/lib/agent/rerun";
import { getTool } from "@/lib/agent/registry";
import type { AgentMode } from "@/lib/agent/loop";
import type { CursorContext } from "@/lib/agent/types";

/**
 * Shared server logic for Regenerate (D2) and Edit-and-resend (D3). Both
 * route families (item-bound + by-id) resolve a threadId, then call this:
 * it claims the turn lock, plans the re-run (find anchor + refuse if the
 * discarded segment already committed a write), truncates the trailing
 * rows, and streams a fresh turn via runAgentTurn with appendUserMessage
 * = false (the anchor user row already exists).
 */

const SSE_HEADERS = {
  "content-type": "text/event-stream",
  "cache-control": "no-cache, no-transform",
  "x-accel-buffering": "no",
  connection: "keep-alive",
} as const;

function jsonError(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const ringOf = (name: string) => getTool(name)?.ring;

export type RerunInput =
  | {
      kind: "regenerate";
      cursor: CursorContext;
      mode?: AgentMode;
    }
  | {
      kind: "edit";
      messageId: string;
      content: string;
      cursor: CursorContext;
      mode?: AgentMode;
    };

export async function streamRerun(opts: {
  userId: string;
  threadId: string;
  input: RerunInput;
  signal: AbortSignal;
}): Promise<Response> {
  const { userId, threadId, input, signal } = opts;

  // A1: claim the single in-flight turn slot before mutating anything, so
  // a concurrent normal turn / second regenerate can't interleave.
  const turnId = await claimThreadTurn({ userId, threadId });
  if (!turnId) {
    return jsonError(409, {
      error: "turn_in_progress",
      message: "Mashi is still working on this thread in another tab.",
    });
  }

  // From here on, every early return must release the lock; only the
  // successful path hands the lock to runAgentTurn (which releases it in
  // its finally).
  try {
    const rows = (await loadLiveMessagesForRerun({
      userId,
      threadId,
    })) as unknown as RerunMessageRow[];

    const target =
      input.kind === "edit"
        ? ({ mode: "message", messageId: input.messageId } as const)
        : ({ mode: "last" } as const);

    const plan = planRerun(rows, target, ringOf);
    if (!plan.ok) {
      await releaseThreadTurn({ userId, threadId, turnId });
      if (plan.reason === "no_anchor") {
        return jsonError(404, {
          error: "no_anchor",
          message:
            input.kind === "edit"
              ? "That message can't be edited."
              : "There's nothing to regenerate yet.",
        });
      }
      return jsonError(409, {
        error: "committed_write",
        message: `Mashi already took an action${
          plan.tool ? ` (${plan.tool})` : ""
        } in this turn, so it can't be redone. Start a new message instead.`,
      });
    }

    // D3: persist the edited content on the anchor row before truncating,
    // so the re-run reads the new text. The anchor itself (seq) survives
    // the truncation below (seq > anchor).
    let userMessage = plan.anchor.content ?? "";
    if (input.kind === "edit") {
      const updated = await updateUserMessageContent({
        userId,
        threadId,
        messageId: input.messageId,
        content: input.content,
        cursorContext: input.cursor,
      });
      if (!updated) {
        await releaseThreadTurn({ userId, threadId, turnId });
        return jsonError(404, {
          error: "no_anchor",
          message: "That message can't be edited.",
        });
      }
      userMessage = input.content;
    }

    // Discard the trailing assistant + tool rows (soft-delete, kept for
    // auditability). After this the anchor user row is the last live row.
    await truncateThreadAfterSeq({ userId, threadId, afterSeq: plan.anchor.seq });

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const enqueue = (d: AgentDelta) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(d)}\n\n`));
          } catch {
            // already closed
          }
        };
        try {
          await runAgentTurn({
            threadId,
            userId,
            userMessage,
            cursor: input.cursor,
            onDelta: enqueue,
            toolRings: ["read", "write_mashi", "write_world"],
            mode: input.mode,
            turnId,
            signal,
            // P2.b: the anchor user row already exists — don't re-append it.
            appendUserMessage: false,
          });
        } catch (err) {
          enqueue({
            kind: "error",
            message: err instanceof Error ? err.message : "agent turn failed",
          });
        } finally {
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
      },
    });

    return new Response(stream, { headers: SSE_HEADERS });
  } catch (err) {
    // Anything thrown before the stream took ownership of the lock: release
    // it so the thread doesn't wedge until the TTL.
    await releaseThreadTurn({ userId, threadId, turnId }).catch(() => {});
    return jsonError(500, {
      error: "rerun_failed",
      message: err instanceof Error ? err.message : "Couldn't re-run the turn.",
    });
  }
}
