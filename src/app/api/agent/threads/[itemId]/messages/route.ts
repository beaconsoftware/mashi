import { NextRequest } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { runAgentTurn, type AgentDelta } from "@/lib/agent/loop";
import { claimThreadTurn, getOrCreateThreadForItem } from "@/lib/agent/threads";
import { MAX_FILES, sanitizeAttachments } from "@/lib/agent/attachments";
import { MAX_REFERENCES, sanitizeReferences } from "@/lib/agent/references";
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

// B1 (P3): attachment descriptors the composer uploaded to Storage. Bytes
// are never in the body; this is the pointer + metadata. Re-validated
// against the user prefix below (sanitizeAttachments) so a forged path
// can't reference another user's object.
const attachmentSchema = z.object({
  kind: z.enum(["image", "document"]),
  storagePath: z.string().min(1).max(512),
  mime: z.string().min(1).max(128),
  name: z.string().min(1).max(256),
  size: z.number().int().nonnegative(),
});

// B2 (P3): @-mention references the composer pinned. Shape-validated here;
// the loop re-validates each id against the user's own s2d_items and rebuilds
// the canonical label/ticket before persisting (so forged ids + arbitrary
// client prose never reach the model).
const referenceSchema = z.object({
  kind: z.literal("item"),
  id: z.string().min(1).max(128),
  label: z.string().max(256).optional(),
  ticketNumber: z.number().int().nullable().optional(),
});

const bodySchema = z
  .object({
    // B1: message is optional when attachments are present ("summarize
    // this" with just a screenshot). The refine below requires at least one.
    message: z.string().max(8_000).default(""),
    attachments: z.array(attachmentSchema).max(MAX_FILES).optional(),
    references: z.array(referenceSchema).max(MAX_REFERENCES).optional(),
    cursor: cursorSchema,
    // Quality Phase 3+: caller-asserted plan/act mode. The mode toggle
    // PATCHes the thread row but the user's intent can be ahead of the
    // PATCH (slow network, replica lag) when they send the next message.
    // Passing mode in the body honors UI intent for this turn regardless
    // of whether the row write has landed yet. Optional — falls back to
    // the persisted thread row in the loop.
    mode: z.enum(["plan", "act"]).optional(),
  })
  .refine(
    (d) => d.message.trim().length > 0 || (d.attachments?.length ?? 0) > 0,
    { message: "Send a message or attach a file." }
  );

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

  // B1: drop any descriptor whose path isn't under this user's prefix or
  // fails the mime/size caps, so a forged body can't smuggle in a foreign
  // or oversized file.
  const attachments = sanitizeAttachments(parsed.data.attachments, {
    expectedPrefix: userId,
  });
  // B2: shape-sanitize references; the loop canonicalizes the ids against
  // the user's own s2d_items before persisting.
  const references = sanitizeReferences(parsed.data.references);

  const thread = await getOrCreateThreadForItem({
    userId,
    itemId,
  });

  // A1: claim the single in-flight turn slot before streaming. If another
  // tab / double-send is mid-turn, refuse with 409 rather than interleave
  // message rows and corrupt the replay history.
  const turnId = await claimThreadTurn({ userId, threadId: thread.id });
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
          attachments,
          references,
          onDelta: enqueue,
          // Phase 5: ring 3 (write_world) gated by the approval card.
          toolRings: ["read", "write_mashi", "write_world"],
          mode: parsed.data.mode,
          turnId,
          // A3: a closed tab / Stop click aborts this request; forward the
          // signal so the loop cancels the upstream model call and the
          // approval poll instead of running to completion server-side.
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
