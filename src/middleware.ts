import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Refresh the Supabase session on every request and gate the dashboard
 * behind authentication. Public routes: /auth/*, /api/auth/*.
 */
export async function middleware(req: NextRequest) {
  let res = NextResponse.next({ request: req });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value));
          res = NextResponse.next({ request: req });
          cookiesToSet.forEach(({ name, value, options }) =>
            res.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // CRITICAL: must call getUser() to refresh the auth token. Do not skip.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = req.nextUrl;
  const isPublic =
    pathname.startsWith("/auth") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    // MCP routes authenticate via Bearer token (mashi_api_tokens), not
    // via Supabase session. Skip the session gate so the DXT can call
    // them without an OAuth cookie.
    pathname.startsWith("/api/mcp");

  if (!user && !isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = "/auth/sign-in";
    url.searchParams.set("redirect", pathname);
    return NextResponse.redirect(url);
  }

  if (user && pathname.startsWith("/auth/sign-in")) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Onboarding gate. Routes the onboarding flow itself needs (the wizard,
  // plus the settings/companies pages it deep-links to) bypass the gate
  // so we don't get a redirect loop. Everything else under (dashboard)
  // requires onboarded=true.
  if (user && !isPublic && !pathname.startsWith("/onboard")) {
    const onboardingAllowed =
      pathname.startsWith("/settings/connections") ||
      pathname.startsWith("/settings/style") ||
      pathname.startsWith("/companies") ||
      pathname.startsWith("/api/"); // API routes manage their own auth

    if (!onboardingAllowed) {
      const { data: profile, error } = await supabase
        .from("user_profile")
        .select("onboarding_step, onboarded_at")
        .eq("user_id", user.id)
        .maybeSingle();

      // If the column doesn't exist yet (migration pending), let them through.
      const migrationPending =
        !!error && /could not find|does not exist/i.test(error.message);

      if (!migrationPending) {
        const step = profile?.onboarding_step ?? 0;
        if (step < 6 && !profile?.onboarded_at) {
          const url = req.nextUrl.clone();
          url.pathname = "/onboard";
          url.search = "";
          return NextResponse.redirect(url);
        }
      }
    }
  }

  return res;
}

export const config = {
  matcher: [
    // Run on everything except static assets + images
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
