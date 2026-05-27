import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadThread } from "@/lib/agent/threads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET → load a thread (orphan or item-bound) by its primary key.
 *
 * The item-id-keyed route exists in parallel for item-bound threads
 * because that's the typical access pattern from Ask Mashi. This
 * route is the only way to fetch an orphan Spotlight thread, since
 * those have no item id.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const supabase = await createSupabaseServerClient();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const { threadId } = await params;
  const { thread, messages } = await loadThread({
    userId: userData.user.id,
    threadId,
  });
  if (!thread) {
    return NextResponse.json({ error: "Thread not found." }, { status: 404 });
  }
  return NextResponse.json({ thread, messages });
}
