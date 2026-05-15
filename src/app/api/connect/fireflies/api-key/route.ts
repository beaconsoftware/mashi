import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { completeOAuthFlow } from "@/lib/oauth/flow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/connect/fireflies/api-key
 * Body: { apiKey: string }
 *
 * Fireflies doesn't expose OAuth; users paste a personal API key from
 * https://app.fireflies.ai/settings → Developer Settings. We synthesize
 * an OAuth flow state, then reuse the standard completeOAuthFlow path so
 * the connection lands in the same connected_accounts table.
 */
export async function POST(req: NextRequest) {
  const { apiKey } = (await req.json()) as { apiKey?: string };
  if (!apiKey || apiKey.length < 8) {
    return new Response(JSON.stringify({ error: "API key looks too short" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("unauthorized", { status: 401 });

  // Synthesize a state token so completeOAuthFlow runs through the same
  // verification path (and burns it after use).
  const state = randomBytes(24).toString("base64url");
  await supabase.from("oauth_flow_states").insert({
    state,
    user_id: user.id,
    provider: "fireflies",
    redirect_after: "/settings/connections",
  });

  try {
    const { connectionId } = await completeOAuthFlow({
      provider: "fireflies",
      code: apiKey,
      state,
    });
    return NextResponse.json({ connectionId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "API key validation failed";
    return new Response(JSON.stringify({ error: msg }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
}
