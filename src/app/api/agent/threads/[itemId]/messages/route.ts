import { NextRequest } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { runAgentTurn, type AgentDelta } from "@/lib/agent/loop";
import { getOrCreateThreadForItem } from "@/lib/agent/threads";
import type { CursorContext } from "@/lib/agent/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Streaming through Vercel: bump the cap so a long tool-using turn
// (multiple iterations) doesn't get killed at the default 10s.
export const maxDuration = 60;

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
          // Phase 3 expands the in-app agent to ring-2 writes. Ring 3
          // (write_world) stays off until Phase 5's approval gate
          // ships.
          toolRings: ["read", "write_mashi"],
          onDelta: enqueue,
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
