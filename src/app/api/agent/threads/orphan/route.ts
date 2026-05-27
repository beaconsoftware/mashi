import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST → create a brand-new orphan agent thread for the user.
 *
 * Orphan threads are how Spotlight ⌘+K conversations start when the
 * user hasn't named a specific item yet. The agent's resolve_reference
 * + attach_thread_to_item pair promotes the orphan to an item-bound
 * thread mid-conversation.
 *
 * Title format: "Spotlight chat, <YYYY-MM-DD HH:MM>" — distinguishable
 * in list_recent_threads without revealing anything about what the
 * user was working on.
 */
export async function POST(_req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const userId = userData.user.id;

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(
    now.getUTCDate()
  )} ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}`;

  const insert = await supabase
    .from("agent_threads")
    .insert({
      user_id: userId,
      item_id: null,
      title: `Spotlight chat, ${stamp}`,
    })
    .select("*")
    .single();

  if (insert.error || !insert.data) {
    return NextResponse.json(
      {
        error:
          insert.error?.message ?? "Couldn't create the Spotlight thread.",
      },
      { status: 500 }
    );
  }
  return NextResponse.json({ thread: insert.data });
}
