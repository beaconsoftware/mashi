"use client";

// translucency-audit-ok: file — glassmorphic sign-in card uses
// intentional off-scale alphas (white/[0.04], white/[0.08]) for the
// frosted-glass effect over the animated aurora background. The
// sanctioned in-app scale (/15/40/55/60/80/95) is too opaque for this
// look. Scoped to this one page; doesn't escape into in-app chrome.

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Translate the raw error params Supabase appends to the redirect URL
 * into something a human can act on. Supabase puts errors in both
 * the search params AND the URL fragment (e.g. `?error=...&#error=...`),
 * so we read from both.
 */
function parseAuthError(search: URLSearchParams, hash: string): string | null {
  const fragment = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const code = fragment.get("error_code") ?? search.get("error_code") ?? "";
  const description = fragment.get("error_description") ?? search.get("error_description") ?? "";
  const error = fragment.get("error") ?? search.get("error") ?? "";

  if (!code && !description && !error) return null;

  // Friendly mapping for the common ones we've actually seen
  if (description.includes("Database error saving new user")) {
    return "Supabase couldn't create your account. This is usually a server-side trigger failure, ping an admin.";
  }
  if (description.toLowerCase().includes("not on the signup allowlist")) {
    return "Your email domain isn't on the allowlist yet. Ask an admin to add it.";
  }
  if (code === "access_denied" || error === "access_denied") {
    return "Sign-in was cancelled. Try again whenever.";
  }
  if (error === "missing_code") {
    return "OAuth handshake didn't complete. Try signing in again.";
  }
  // Fallback — show the description if Supabase gave one, otherwise the code
  return description.replace(/\+/g, " ") || code || error;
}

export function SignInForm() {
  const search = useSearchParams();
  const redirectTo = search.get("redirect") ?? "/";

  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pick up errors that Supabase / our /auth/callback handler appended
  // to the URL on a failed sign-in round-trip.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const msg = parseAuthError(
      new URLSearchParams(window.location.search),
      window.location.hash
    );
    if (msg) setError(msg);
  }, []);

  async function signInWithGoogle() {
    setSigning(true);
    setError(null);

    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?redirect=${encodeURIComponent(redirectTo)}`,
      },
    });

    if (error) {
      setError(error.message);
      setSigning(false);
    }
    // On success the browser is redirected to Google; nothing more to do here.
  }

  return (
    // Glassmorphic card: heavy backdrop-blur + low-opacity background +
    // soft white border so it reads as frosted glass over the animated
    // aurora behind it. The shadcn Card defaults (bg-card opaque) would
    // hide the aurora entirely — overrides flip it to a glass surface.
    // translucency-audit-ok: sign-in is a one-off surface, intentional
    // off-scale alpha for the glassmorphic effect that's the design goal.
    <Card className="border-white/10 bg-white/[0.04] shadow-2xl shadow-black/40 backdrop-blur-2xl">
      <CardContent className="space-y-3 p-5">
        <Button
          onClick={signInWithGoogle}
          disabled={signing}
          variant="outline"
          className="h-10 w-full gap-2 border-white/10 bg-white/[0.04] text-sm backdrop-blur-md hover:bg-white/[0.08]"
        >
          <GoogleGlyph />
          {signing ? "Redirecting to Google…" : "Continue with Google"}
        </Button>
        {error && (
          <div className="flex items-start gap-2 rounded border border-destructive/30 bg-destructive/10 p-2 text-[12px] text-destructive backdrop-blur-md">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function GoogleGlyph() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      aria-hidden
      className="shrink-0"
    >
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}
