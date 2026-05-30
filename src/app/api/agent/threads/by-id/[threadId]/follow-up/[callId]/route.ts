import { NextRequest } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { runAgentTurn, type AgentDelta } from "@/lib/agent/loop";
import { claimThreadTurn } from "@/lib/agent/threads";
import type { CursorContext } from "@/lib/agent/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/agent/threads/by-id/[threadId]/follow-up/[callId]
 *
 * Orphan-thread twin of the itemId follow-up route. Used by Spotlight
 * chats where there's no itemId in the URL yet. Same shape, same SSE
 * stream as /messages.
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
  { params }: { params: Promise<{ threadId: string; callId: string }> }
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

  const { threadId } = await params;
  const userId = userData.user.id;

  const owned = await supabase
    .from("agent_threads")
    .select("id")
    .eq("user_id", userId)
    .eq("id", threadId)
    .maybeSingle();
  if (!owned.data) {
    return new Response("Thread not found", { status: 404 });
  }

  // A1: claim the single in-flight turn slot before streaming (see the
  // item-bound /messages route for rationale).
  const turnId = await claimThreadTurn({ userId, threadId });
  if (!turnId) {
    return new Response(
      JSON.stringify({
        error: "turn_in_progress",
        message: "Mashi is still working on this thread in another tab.",
      }),
      { status: 409, headers: { "content-type": "application/json" } }
    );
  }

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
          threadId,
          userId,
          userMessage: parsed.data.chosen,
          cursor: parsed.data.cursor as CursorContext,
          onDelta: enqueue,
          toolRings: ["read", "write_mashi", "write_world"],
          turnId,
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
