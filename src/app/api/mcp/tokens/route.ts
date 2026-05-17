import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { generateToken } from "@/lib/mcp/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET — list this user's API tokens (metadata only, no secrets).
 * POST — create a new token; the plaintext is returned ONCE in the
 *        response and never stored. Caller must save it immediately.
 */

export async function GET() {
  const sb = await createSupabaseServerClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data, error } = await sb
    .from("mashi_api_tokens")
    .select("id, name, token_prefix, scopes, created_at, last_used_at, revoked_at")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tokens: data ?? [] });
}

export async function POST(req: NextRequest) {
  const sb = await createSupabaseServerClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { name?: string };
  const name = (body.name ?? "").trim() || "Untitled token";

  const { plaintext, hash, prefix } = generateToken();
  const { data, error } = await sb
    .from("mashi_api_tokens")
    .insert({
      user_id: user.id,
      name,
      token_hash: hash,
      token_prefix: prefix,
      scopes: ["read"],
    })
    .select("id, name, token_prefix, scopes, created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Plaintext is returned ONCE here and is otherwise unrecoverable.
  return NextResponse.json({ token: data, plaintext });
}
