import { Suspense } from "react";
import { SignInForm } from "@/components/auth/sign-in-form";
import { SignInBackground } from "@/components/auth/sign-in-background";
import { MashiMark } from "@/components/shared/mashi-mark";

export const dynamic = "force-dynamic";

/**
 * Sign-in page — animated aurora background + glassmorphic card.
 *
 * `relative` on the wrapper makes <main>-style stacking explicit (per
 * the AGENTS.md "Stacking buckets" doctrine): the background mounts as
 * `fixed inset-0 z-ground` and would paint on top of unpositioned
 * block siblings otherwise. The content wrapper has its own z-shell
 * to sit cleanly above the aurora.
 */
export default function SignInPage() {
  return (
    <div className="relative flex min-h-screen items-center justify-center p-6">
      <SignInBackground />
      <div className="relative z-shell w-full max-w-sm space-y-6">
        <div className="space-y-2 text-center">
          {/* Logo tile with a soft amber halo so the brand reads as
              warmth-on-glow rather than a flat square. The blur sits
              behind the tile via `before:` — no extra DOM. */}
          <div className="relative mx-auto h-12 w-12">
            <div
              aria-hidden
              className="absolute inset-0 -z-10 rounded-2xl bg-primary/40 blur-2xl"
            />
            <div className="flex h-12 w-12 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-lg shadow-primary/30">
              <MashiMark size={26} />
            </div>
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            Mashi
          </h1>
          <p className="text-sm text-muted-foreground">
            Personal AI Chief of Staff.
          </p>
        </div>
        <Suspense>
          <SignInForm />
        </Suspense>
      </div>
    </div>
  );
}
