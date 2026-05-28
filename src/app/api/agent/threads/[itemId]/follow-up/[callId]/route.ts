import { NextRequest } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { runAgentTurn, type AgentDelta } from "@/lib/agent/loop";
import { getOrCreateThreadForItem } from "@/lib/agent/threads";
import type { CursorContext } from "@/lib/agent/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Same 300s ceiling as /messages so a follow-up turn that itself hits a
// ring-3 approval gate gets the full window.
export const maxDuration = 300;

/**
 * POST /api/agent/threads/[itemId]/follow-up/[callId]
 *
 * Resolves a pending ask_followup_question tool call by appending the
 * chosen option as the next user turn and re-streaming a single agent
 * turn over SSE. Same wire shape as /messages so the client can hand
 * the response directly to the existing thread-view stream reader.
 *
 * Body:
 *   { chosen: string, cursor: CursorContext }
 *
 * The `callId` URL segment matches the tool_use_id of the
 * ask_followup_question call. We don't currently validate that it
 * corresponds to the latest unanswered follow-up — the UI tracks
 * resolution state so double-clicks are dropped client-side, and the
 * model itself sees the user's reply as a normal turn regardless of
 * which call id it nominally answers.
 */

const cursorSchema = z.object({
  route: z.string(),
  focusedItemId: z.string().optional(),
  selectedItemIds: z.array(z.string()).optional(),
  activeSprint: z
    .object({
      sprintId: z.string().optional(),
      focusedSlotItemId: z.string().optional(),
      queueItemIds: z.array(z.string()),
    })
    .optional(),
  openSheet: z.enum(["detail", "refine", "spotlight"]).nullable().optional(),
  recentlyViewedItemIds: z.array(z.string()).optional(),
  now: z.string(),
});

const bodySchema = z.object({
  chosen: z.string().min(1).max(8_000),
  cursor: cursorSchema,
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ itemId: string; callId: string }> }
) {
  const supabase = await createSupabaseServerClient();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) {
    return new Response("Not signed in", { status: 401 });
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: parsed.error.issues }),
      { status: 400, headers: { "content-type": "application/json" } }
    );
  }

  const { itemId } = await params;
  const userId = userData.user.id;

  const thread = await getOrCreateThreadForItem({
    userId,
    itemId,
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enqueue = (d: AgentDelta) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(d)}\n\n`)
          );
        } catch {
          // already closed
        }
      };

      try {
        await runAgentTurn({
          threadId: thread.id,
          userId,
          userMessage: parsed.data.chosen,
          cursor: parsed.data.cursor as CursorContext,
          onDelta: enqueue,
          toolRings: ["read", "write_mashi", "write_world"],
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

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
      connection: "keep-alive",
    },
  });
}
