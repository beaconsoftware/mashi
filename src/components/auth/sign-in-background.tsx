"use client";

// translucency-audit-ok: file — sign-in is a one-off marketing-style
// surface with intentional off-scale alphas (white/5, background/30,
// background/55) used for the glassmorphic effect. The sanctioned
// /15/40/55/60/80/95 scale is for in-app chrome; this page predates
// the in-app chrome it lands you in.

/**
 * Sign-in page aurora — animated mesh-gradient background with a slow
 * hue-cycle. The four large blurred radial-gradient blobs drift
 * independently (each on its own ease-in-out yoyo) while a parent
 * `filter: hue-rotate(360deg)` rotates the entire palette over ~32s.
 * Net effect: the page feels alive without ever repeating, and a
 * returning user sees a different "moment" of the cycle each time.
 *
 * Pure CSS. No JS scheduling. All animations run on the compositor
 * (transform + filter), so it stays smooth even mid-OAuth-redirect.
 *
 * The card on top uses `backdrop-blur-2xl + bg-background/30` —
 * classic glassmorphism — and reads cleanly against any phase of the
 * underlying aurora because the blur + opacity wash flattens the
 * background contrast.
 *
 * Respects `prefers-reduced-motion`: keyframe animations short-circuit
 * to no motion (see globals.css). Static gradient is still pretty.
 */
export function SignInBackground() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-ground overflow-hidden bg-background"
    >
      {/* Aurora wrapper — the hue-rotate filter animates here so it
          rotates the WHOLE composed mesh as one palette, not each
          blob independently. */}
      <div className="sign-in-aurora absolute inset-0">
        <div className="sign-in-blob sign-in-blob-a" />
        <div className="sign-in-blob sign-in-blob-b" />
        <div className="sign-in-blob sign-in-blob-c" />
        <div className="sign-in-blob sign-in-blob-d" />
      </div>

      {/* Vignette — pulls the edges back into the background color so
          the aurora reads as a centered glow, not a wallpaper. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 30%, hsl(var(--background) / 0.55) 100%)",
        }}
      />

      {/* Subtle film grain. Pure SVG, no animation (per the perf
          lessons from the album-art ambient). */}
      <svg
        className="absolute inset-0 h-full w-full opacity-[0.06] mix-blend-overlay"
        aria-hidden
        focusable="false"
      >
        <filter id="sign-in-grain">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.9"
            numOctaves="2"
            stitchTiles="stitch"
            seed="13"
          />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 1
                    0 0 0 0 1
                    0 0 0 0 1
                    0 0 0 0.5 0"
          />
        </filter>
        <rect width="100%" height="100%" filter="url(#sign-in-grain)" />
      </svg>
    </div>
  );
}
