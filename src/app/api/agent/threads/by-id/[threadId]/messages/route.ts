import { NextRequest } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { runAgentTurn, type AgentDelta } from "@/lib/agent/loop";
import { claimThreadTurn } from "@/lib/agent/threads";
import { MAX_FILES, sanitizeAttachments } from "@/lib/agent/attachments";
import type { CursorContext } from "@/lib/agent/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Bumped to 300s for ring-3 approval gates (Phase 5).
export const maxDuration = 300;

/**
 * POST → stream a single agent turn over SSE for a thread keyed by id.
 *
 * Used by the Spotlight surface for orphan threads, plus any
 * orphan-thread continuation after attach_thread_to_item rebinds it
 * to an item. The item-bound flow uses /api/agent/threads/[itemId]/
 * messages, which creates-on-demand from the item id — the by-id
 * route does not auto-create, so it 404s for unknown thread ids.
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

// B1 (P3): see the item-bound route for the rationale + prefix re-check.
const attachmentSchema = z.object({
  kind: z.enum(["image", "document"]),
  storagePath: z.string().min(1).max(512),
  mime: z.string().min(1).max(128),
  name: z.string().min(1).max(256),
  size: z.number().int().nonnegative(),
});

const bodySchema = z
  .object({
    message: z.string().max(8_000).default(""),
    attachments: z.array(attachmentSchema).max(MAX_FILES).optional(),
    cursor: cursorSchema,
    // Quality Phase 3+: caller-asserted plan/act mode. See the item-bound
    // route for the rationale. Optional — falls back to the persisted
    // thread row in the loop.
    mode: z.enum(["plan", "act"]).optional(),
  })
  .refine(
    (d) => d.message.trim().length > 0 || (d.attachments?.length ?? 0) > 0,
    { message: "Send a message or attach a file." }
  );

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
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

  // B1: re-validate attachments against this user's prefix + caps.
  const attachments = sanitizeAttachments(parsed.data.attachments, {
    expectedPrefix: userId,
  });

  // A1: claim the single in-flight turn slot before streaming (see the
  // item-bound route for rationale).
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
          userMessage: parsed.data.message,
          cursor: parsed.data.cursor as CursorContext,
          attachments,
          onDelta: enqueue,
          toolRings: ["read", "write_mashi", "write_world"],
          mode: parsed.data.mode,
          turnId,
          // A3: forward the request abort signal (see the item-bound route).
          signal: req.signal,
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
