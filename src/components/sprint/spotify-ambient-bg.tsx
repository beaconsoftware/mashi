"use client";

import { forwardRef, useEffect, useMemo, useReducer, useRef } from "react";
import { gsap, withMotion } from "@/lib/animation";
import { useSpotifyState } from "@/hooks/use-spotify";
import { AmbientGround } from "@/components/layout/primitives";

/**
 * Ambient album-art background.
 *
 * Renders the current Spotify track's album art as a softly-blurred,
 * gently-rotating ground beneath the app UI. On track change, two
 * layers crossfade so there's no flash. When music is paused, the
 * rotation slows to a near-stop instead of continuing to spin.
 *
 * Layered top-down:
 *   1. ArtLayer (current)     - blurred album art, transform-animated
 *   2. ArtLayer (previous)    - same, for crossfade
 *   3. Grain overlay          - animated noise, gives a subtle "film" feel
 *   4. Color darkener         - bg/55 so foreground text stays legible
 *   5. Vignette gradient      - softens the edges into the page bg
 *
 * Implementation choices:
 * - Two stacked layers so swap is a CSS opacity crossfade, not reload-flash.
 * - GSAP animates only transform properties (rotate, scale), never
 *   boxShadow, per the AGENTS.md GSAP gotcha.
 * - The grain overlay animates by shifting the SVG noise base frequency
 *   over time. Cheap on the GPU since it's a stable filter.
 * - Respects prefers-reduced-motion via withMotion wrapper.
 *
 * `fixed inset-0 pointer-events-none` so it can mount once at the
 * AppShell layer and sit behind every page without intercepting clicks.
 */
export function SpotifyAmbientBg({ enabled }: { enabled: boolean }) {
  const { data } = useSpotifyState({ enabled });
  const url = data?.track?.album_image_url ?? null;
  const playing = !!data?.playing;

  // Crossfade state: keep prev + current URL on two layers. A reducer
  // is used so the "incorporate new url" transition is a pure event,
  // not a setState-in-effect (which the React Compiler rules forbid).
  const [layers, dispatch] = useReducer(
    (
      prev: { a: string | null; b: string | null; show: "a" | "b" },
      next: string | null
    ) => {
      if (next == null) return prev;
      const active = prev.show === "a" ? prev.a : prev.b;
      if (active === next) return prev;
      if (prev.show === "a") {
        return { a: prev.a, b: next, show: "b" as const };
      }
      return { a: next, b: prev.b, show: "a" as const };
    },
    { a: null, b: null, show: "a" } as { a: string | null; b: string | null; show: "a" | "b" }
  );
  // Sync url into the reducer. dispatch IS allowed inside an effect.
  useEffect(() => {
    dispatch(url);
  }, [url]);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const aRef = useRef<HTMLDivElement | null>(null);
  const bRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!aRef.current || !bRef.current) return;
    withMotion(() => {
      gsap.to(aRef.current, {
        opacity: layers.show === "a" ? 1 : 0,
        duration: 1.4,
        ease: "power2.inOut",
      });
      gsap.to(bRef.current, {
        opacity: layers.show === "b" ? 1 : 0,
        duration: 1.4,
        ease: "power2.inOut",
      });
    });
  }, [layers.show]);

  // PERF: previously this ran an infinite rotate+scale yoyo timeline
  // (24s sine) on the root so the album art slowly drifted while music
  // played. Looked nice — but it was a continuous transform animation
  // on the layer that every <ChromeBar>'s backdrop-blur samples, which
  // forced the browser to re-blur every ChromeBar on every frame for
  // the entire session. With multiple bars stacked on /sprint and a
  // page transition on top, that was the dominant cost in the 2fps
  // navigation jank.
  //
  // Replaced with a one-shot static set: scale 1.1 so the art slightly
  // oversizes the viewport (gives the displacement filter pixels to
  // pull from at the edges so we don't get void/black at the boundary).
  // No rotation, no perpetual JS loop. The track-change crossfade
  // below is the only animation left on the ambient layer, and it
  // fires once per song, not per frame.
  //
  // `playing` is preserved as a dep in case we ever want to bring a
  // gated motion back (e.g. a 0.05Hz CSS sway while playing). Today it
  // intentionally does nothing.
  useEffect(() => {
    if (!rootRef.current) return;
    withMotion(() => {
      gsap.killTweensOf(rootRef.current);
      gsap.set(rootRef.current, { rotate: 0, scale: 1.1 });
    });
  }, [playing]);

  const everHadArt = useMemo(() => Boolean(layers.a || layers.b), [layers.a, layers.b]);
  if (!everHadArt) return null;

  return (
    <AmbientGround ref={rootRef}>
      {/* IMPORTANT: the displacement filter is NOT applied here on the
          root. Previously it was, which meant the darkener layer + the
          vignette gradient also got displaced — and displacing a smooth
          gradient produces visible wavy dark splotches at the edges
          where the displacement is strongest. Applying the filter
          exclusively to each ArtLayer keeps the smoothing layers
          undistorted. */}
      <svg
        className="pointer-events-none absolute -z-10 h-0 w-0 opacity-0"
        aria-hidden
        focusable="false"
      >
        <defs>
          <filter id="mashi-spotify-distort" x="-15%" y="-15%" width="130%" height="130%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.008 0.012"
              numOctaves="2"
              seed="3"
              result="noise"
            />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="24" />
          </filter>
          {/* Grain overlay filter — sharp noise so it reads as film grain.
              PERF: the baseFrequency used to animate over 22s for a
              shimmer effect, but `<animate>` on an SVG filter
              parameter is the same kind of continuous invalidation as
              the GSAP rotate loop above — every ChromeBar's
              backdrop-blur has to re-sample because the noise pattern
              changes. Now a static seed. The grain still reads as
              texture, just not shimmery. Worth the cost — it was
              forcing a per-frame blur recompute for an effect almost
              no one would consciously notice. */}
          <filter id="mashi-spotify-grain" x="0%" y="0%" width="100%" height="100%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.9"
              numOctaves="2"
              stitchTiles="stitch"
              seed="7"
            />
            <feColorMatrix
              type="matrix"
              values="0 0 0 0 1
                      0 0 0 0 1
                      0 0 0 0 1
                      0 0 0 0.32 0"
            />
          </filter>
        </defs>
      </svg>

      <ArtLayer ref={aRef} url={layers.a} initialOpacity={layers.show === "a" ? 1 : 0} />
      <ArtLayer ref={bRef} url={layers.b} initialOpacity={layers.show === "b" ? 1 : 0} />

      {/* Animated grain overlay — sits above art, below the color darkener
          so it reads as texture on the art rather than texture on text. */}
      <div
        className="absolute inset-0 opacity-40 mix-blend-overlay"
        style={{ filter: "url(#mashi-spotify-grain)" }}
      />

      {/* Color darkener — keeps foreground text legible. Bumped from
          bg/45 to bg/60 because bright/medium-luminance art was washing
          out muted-foreground text (filter chips, secondary labels,
          empty-state copy). The art is still visibly tinted through
          this layer — just less aggressive. */}
      <div className="absolute inset-0 bg-background/60 backdrop-blur-md" />

      {/* Vignette — also bumped (0.25/0.55 -> 0.35/0.7) so edges (where
          the sidebar and other dark surfaces meet the ambient) don't
          have a bright halo against muted text. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 0%, hsl(var(--background) / 0.35) 70%, hsl(var(--background) / 0.7) 100%)",
        }}
      />
    </AmbientGround>
  );
}

const ArtLayer = forwardRef<
  HTMLDivElement,
  { url: string | null; initialOpacity: number }
>(function ArtLayer({ url, initialOpacity }, ref) {
  if (!url) {
    return <div ref={ref} className="absolute inset-0" style={{ opacity: initialOpacity }} />;
  }
  return (
    <div
      ref={ref}
      className="absolute inset-0 bg-cover bg-center"
      style={{
        opacity: initialOpacity,
        backgroundImage: `url(${url})`,
        // Stack: displacement first (so it reads as liquid distortion
        // on the unblurred source) -> blur -> saturate -> brightness.
        // Order matters: blurring after displacement smooths the
        // displacement edges; reversing the stack creates a sharper,
        // more aggressive distortion that's harder to make read as
        // ambient.
        filter:
          "url(#mashi-spotify-distort) blur(36px) saturate(1.4) brightness(0.9)",
        // scale 1.35 gives the displacement filter plenty of art to
        // pull from at the edges so we don't get void/black splotches
        // pulled in at the viewport boundary.
        transform: "scale(1.35)",
      }}
    />
  );
});
