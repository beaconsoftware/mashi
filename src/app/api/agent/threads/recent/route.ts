import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET → recent agent threads for the signed-in user, newest first.
 *
 * Powers the Spotlight Ask-Mashi tab's "Recent" rail. Mirrors the
 * shape of the `list_recent_threads` tool so the UI and the agent
 * see the same data, but reads via the session-cookie path so the
 * board doesn't need to mint a PAT for itself.
 */
export async function GET(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  const userId = userData.user.id;

  const limitParam = req.nextUrl.searchParams.get("limit");
  const limit = Math.min(
    Math.max(limitParam ? Number(limitParam) : 8, 1),
    50
  );

  const { data, error } = await supabase
    .from("agent_threads")
    .select("id, title, item_id, last_message_at, created_at")
    .eq("user_id", userId)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const rows = (data ?? []) as Array<{
    id: string;
    title: string;
    item_id: string | null;
    last_message_at: string | null;
    created_at: string;
  }>;

  // Hydrate ticket numbers for bound threads in one extra query.
  const boundItemIds = rows
    .map((r) => r.item_id)
    .filter((x): x is string => !!x);
  let ticketByItem = new Map<string, number | null>();
  if (boundItemIds.length > 0) {
    const items = await supabase
      .from("s2d_items")
      .select("id, ticket_number")
      .eq("user_id", userId)
      .in("id", boundItemIds);
    const itemRows = (items.data ?? []) as Array<{
      id: string;
      ticket_number: number | null;
    }>;
    ticketByItem = new Map(itemRows.map((r) => [r.id, r.ticket_number]));
  }

  const threads = rows.map((r) => ({
    id: r.id,
    title: r.title,
    item_id: r.item_id,
    ticket_number: r.item_id ? ticketByItem.get(r.item_id) ?? null : null,
    last_message_at: r.last_message_at,
    created_at: r.created_at,
    is_orphan: r.item_id == null,
  }));
  return NextResponse.json({ threads });
}
