import { NextRequest, NextResponse } from "next/server";
import { completeOAuthFlow } from "@/lib/oauth/flow";
import type { ProviderKey } from "@/lib/oauth/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/connect/:provider/callback
 *
 * Generic OAuth callback. Validates state, exchanges the code, stores the
 * encrypted tokens, then redirects to the user's chosen post-connect page
 * (usually /settings/connections).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  const url = req.nextUrl;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  // User cancelled / provider returned an error
  if (errorParam) {
    const back = new URL("/settings/connections", url.origin);
    back.searchParams.set("error", errorParam);
    return NextResponse.redirect(back);
  }

  if (!code || !state) {
    const back = new URL("/settings/connections", url.origin);
    back.searchParams.set("error", "missing_code_or_state");
    return NextResponse.redirect(back);
  }

  try {
    const { redirectAfter } = await completeOAuthFlow({
      provider: provider as ProviderKey,
      code,
      state,
    });
    const dest = new URL(redirectAfter, url.origin);
    dest.searchParams.set("connected", provider);
    return NextResponse.redirect(dest);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "OAuth callback failed";
    const back = new URL("/settings/connections", url.origin);
    back.searchParams.set("error", msg);
    return NextResponse.redirect(back);
  }
}
