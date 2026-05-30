import { NextRequest } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { streamRerun } from "@/lib/agent/rerun-stream";
import type { CursorContext } from "@/lib/agent/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** POST → regenerate the last turn for a thread keyed by id (D2). See the
 * item-bound twin for the contract. */

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
  cursor: cursorSchema,
  mode: z.enum(["plan", "act"]).optional(),
});

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
    return new Response(JSON.stringify({ error: parsed.error.issues }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
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

  return streamRerun({
    userId,
    threadId,
    signal: req.signal,
    input: {
      kind: "regenerate",
      cursor: parsed.data.cursor as CursorContext,
      mode: parsed.data.mode,
    },
  });
}
