import { NextRequest, NextResponse } from "next/server";
import { startOAuthFlow } from "@/lib/oauth/flow";
import type { ProviderKey } from "@/lib/oauth/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/connect/:provider
 *
 * Begins an OAuth flow. Redirects the user's browser to the provider's
 * authorize URL. For API-key-based providers (Fireflies), redirects back
 * to a settings page that opens the API-key dialog.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  const redirectAfter = req.nextUrl.searchParams.get("redirect_after") ?? undefined;

  try {
    const { url } = await startOAuthFlow({
      provider: provider as ProviderKey,
      redirectAfter,
    });

    // Provider sentinel URL → show the API-key dialog in the UI
    if (url.startsWith("mashi://")) {
      const dialogUrl = new URL("/settings/connections", req.nextUrl.origin);
      dialogUrl.searchParams.set("dialog", provider);
      return NextResponse.redirect(dialogUrl);
    }

    return NextResponse.redirect(url);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "OAuth start failed";
    const errorUrl = new URL("/settings/connections", req.nextUrl.origin);
    errorUrl.searchParams.set("error", msg);
    return NextResponse.redirect(errorUrl);
  }
}
