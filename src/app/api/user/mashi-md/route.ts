import { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/user/mashi-md — Quality Phase 5.
 *
 * GET returns the user's MASHI.md memory file.
 * PUT writes a new value. 8000-char limit enforced here so a future
 * cap-bump doesn't need a migration; the column itself is unbounded
 * TEXT.
 */

const MAX_CHARS = 8000;

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { data, error } = await supabase
    .from("user_profile")
    .select("mashi_md")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  const mashiMd =
    (data as { mashi_md?: string } | null)?.mashi_md ?? "";
  return Response.json({ mashi_md: mashiMd });
}

export async function PUT(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: { mashi_md?: unknown };
  try {
    body = (await req.json()) as { mashi_md?: unknown };
  } catch {
    return new Response(JSON.stringify({ error: "invalid json" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (typeof body.mashi_md !== "string") {
    return new Response(
      JSON.stringify({ error: "mashi_md must be a string" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const trimmed = body.mashi_md.replace(/[ \t]+$/gm, "").trimEnd();
  if (trimmed.length > MAX_CHARS) {
    return new Response(
      JSON.stringify({
        error: `MASHI.md exceeds ${MAX_CHARS}-char limit (got ${trimmed.length}).`,
      }),
      { status: 413, headers: { "Content-Type": "application/json" } }
    );
  }

  const { data: existing } = await supabase
    .from("user_profile")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (existing) {
    const { error } = await supabase
      .from("user_profile")
      .update({ mashi_md: trimmed })
      .eq("id", existing.id);
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  } else {
    const { error } = await supabase.from("user_profile").insert({
      user_id: user.id,
      email: user.email,
      mashi_md: trimmed,
    });
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  return Response.json({ mashi_md: trimmed });
}
