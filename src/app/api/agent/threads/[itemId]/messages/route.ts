import { NextRequest } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { runAgentTurn, type AgentDelta } from "@/lib/agent/loop";
import { getOrCreateThreadForItem } from "@/lib/agent/threads";
import type { CursorContext } from "@/lib/agent/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Streaming through Vercel: bump the cap to 300s (Pro tier ceiling) so
// a ring-3 approval gate has up to 5 minutes for the user to decide
// without the stream getting killed mid-wait.
export const maxDuration = 300;

/**
 * POST → streams a single agent turn over Server-Sent Events.
 *
 * Request body:
 *   { message: string, cursor: CursorContext }
 *
 * The route resolves (or creates) the per-item thread, persists the
 * user message, runs the agent loop, and emits one `data: <json>\n\n`
 * frame per AgentDelta. The stream terminates after a `done` or
 * `error` delta. The client should parse line-by-line.
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
  message: z.string().min(1).max(8_000),
  cursor: cursorSchema,
  // Quality Phase 3+: caller-asserted plan/act mode. The mode toggle
  // PATCHes the thread row but the user's intent can be ahead of the
  // PATCH (slow network, replica lag) when they send the next message.
  // Passing mode in the body honors UI intent for this turn regardless
  // of whether the row write has landed yet. Optional — falls back to
  // the persisted thread row in the loop.
  mode: z.enum(["plan", "act"]).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ itemId: string }> }
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
          // Controller may already be closed if the client aborted.
        }
      };
      // Emit the thread id up-front so the client can locate it in its
      // local cache before the model starts streaming.
      enqueue({
        kind: "text",
        text: "",
      });
      controller.enqueue(
        encoder.encode(
          `event: meta\ndata: ${JSON.stringify({ thread_id: thread.id })}\n\n`
        )
      );

      try {
        await runAgentTurn({
          threadId: thread.id,
          userId,
          userMessage: parsed.data.message,
          cursor: parsed.data.cursor as CursorContext,
          onDelta: enqueue,
          // Phase 5: ring 3 (write_world) gated by the approval card.
          toolRings: ["read", "write_mashi", "write_world"],
          mode: parsed.data.mode,
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
