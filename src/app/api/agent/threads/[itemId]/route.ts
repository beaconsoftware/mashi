import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  getOrCreateThreadForItem,
  loadThread,
} from "@/lib/agent/threads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET  → returns { thread, messages } for the item's thread; null when
 *        no thread has been created yet.
 * POST → idempotently creates the thread for the item if missing and
 *        returns { thread, messages }.
 *
 * Path param is the item id, not the thread id. One-thread-per-item is
 * enforced at the DB level, so the route doesn't need a thread-id form.
 */

async function resolveUser() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) return null;
  return { supabase, userId: data.user.id };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ itemId: string }> }
) {
  const auth = await resolveUser();
  if (!auth) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const { itemId } = await params;

  const existing = await auth.supabase
    .from("agent_threads")
    .select("*")
    .eq("user_id", auth.userId)
    .eq("item_id", itemId)
    .maybeSingle();
  if (!existing.data) {
    return NextResponse.json({ thread: null, messages: [] });
  }
  const { messages } = await loadThread({
    userId: auth.userId,
    threadId: existing.data.id,
  });
  return NextResponse.json({ thread: existing.data, messages });
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ itemId: string }> }
) {
  const auth = await resolveUser();
  if (!auth) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const { itemId } = await params;
  try {
    const thread = await getOrCreateThreadForItem({
      userId: auth.userId,
      itemId,
    });
    const { messages } = await loadThread({
      userId: auth.userId,
      threadId: thread.id,
    });
    return NextResponse.json({ thread, messages });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "couldn't create thread" },
      { status: 500 }
    );
  }
}
