"use client";

import { forwardRef, useEffect, useMemo, useReducer, useRef } from "react";
import { gsap, withMotion } from "@/lib/animation";
import { useSpotifyState } from "@/hooks/use-spotify";

/**
 * Ambient album-art background.
 *
 * Renders the current Spotify track's album art as a heavily-blurred,
 * gently-rotating ground beneath the sprint UI. On track change, two
 * layers crossfade so there's no flash. When music is paused, the
 * rotation slows to a near-stop instead of continuing to spin.
 *
 * Implementation choices:
 * - Two stacked img layers (current + previous) so swap is a CSS opacity
 *   crossfade rather than reload-flash.
 * - SVG filter with feTurbulence + feDisplacementMap provides the
 *   noisy "liquid" feel without per-frame canvas redraws.
 * - GSAP animates only transform properties (rotate, scale), never
 *   boxShadow, per the AGENTS.md GSAP gotcha.
 * - Respects prefers-reduced-motion via withMotion wrapper.
 *
 * The component is absolutely positioned and inert (pointer-events:none),
 * so it never intercepts clicks on sprint cards above.
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

  useEffect(() => {
    if (!rootRef.current) return;
    withMotion(() => {
      gsap.killTweensOf(rootRef.current);
      const target = rootRef.current;
      gsap.set(target, { rotate: 0, scale: 1.1 });
      const tl = gsap.timeline({ repeat: -1, yoyo: true });
      const speed = playing ? 1 : 0.15;
      tl.to(target, {
        rotate: 8,
        scale: 1.18,
        duration: 24 / Math.max(speed, 0.15),
        ease: "sine.inOut",
      });
    });
  }, [playing]);

  const everHadArt = useMemo(() => Boolean(layers.a || layers.b), [layers.a, layers.b]);
  if (!everHadArt) return null;

  return (
    <div
      ref={rootRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-0 overflow-hidden"
      style={{ filter: "url(#mashi-spotify-distort)" }}
    >
      <svg
        className="pointer-events-none absolute -z-10 h-0 w-0 opacity-0"
        aria-hidden
        focusable="false"
      >
        <defs>
          <filter id="mashi-spotify-distort" x="-10%" y="-10%" width="120%" height="120%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.008 0.012"
              numOctaves="2"
              seed="3"
              result="noise"
            />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="36" />
          </filter>
        </defs>
      </svg>

      <ArtLayer ref={aRef} url={layers.a} initialOpacity={layers.show === "a" ? 1 : 0} />
      <ArtLayer ref={bRef} url={layers.b} initialOpacity={layers.show === "b" ? 1 : 0} />

      <div className="absolute inset-0 bg-background/70 backdrop-blur-3xl" />
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 0%, hsl(var(--background) / 0.45) 70%, hsl(var(--background) / 0.85) 100%)",
        }}
      />
    </div>
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
        // Strong blur + saturation turns a tiny 300px image into a
        // full-screen color field without revealing pixelation.
        filter: "blur(60px) saturate(1.35) brightness(0.85)",
        transform: "scale(1.15)",
      }}
    />
  );
});
