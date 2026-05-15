import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Magic-link / OAuth callback. Supabase appends a `code` query param;
 * we exchange it for a session and redirect to the original page.
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl.clone();
  const code = url.searchParams.get("code");
  const redirectTo = url.searchParams.get("redirect") ?? "/";

  if (!code) {
    url.pathname = "/auth/sign-in";
    url.searchParams.set("error", "missing_code");
    return NextResponse.redirect(url);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    url.pathname = "/auth/sign-in";
    url.search = "";
    url.searchParams.set("error", error.message);
    return NextResponse.redirect(url);
  }

  // Success — strip the code and redirect.
  const dest = new URL(redirectTo, url.origin);
  return NextResponse.redirect(dest);
}
