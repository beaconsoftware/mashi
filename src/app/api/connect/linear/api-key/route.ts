import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { completeOAuthFlow } from "@/lib/oauth/flow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/connect/linear/api-key
 * Body: { apiKey: string }
 *
 * Linear's OAuth tokens expire every 24h and they don't issue refresh
 * tokens, so we use personal API keys instead (Linear Settings → API →
 * "Personal API keys"). These don't expire and are scoped per workspace.
 *
 * Each key is validated against Linear's GraphQL API before we save it.
 * The same row is updated on re-paste so workspaces don't duplicate.
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

  // Mint a one-shot state token so completeOAuthFlow runs the same
  // verification + upsert path as the OAuth flow.
  const state = randomBytes(24).toString("base64url");
  await supabase.from("oauth_flow_states").insert({
    state,
    user_id: user.id,
    provider: "linear",
    redirect_after: "/settings/connections",
  });

  try {
    const { connectionId } = await completeOAuthFlow({
      provider: "linear",
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
