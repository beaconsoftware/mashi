"use client";

import { useEffect, useRef, useState } from "react";
import { useGSAP } from "@gsap/react";
import { gsap, DUR, EASE, withMotion } from "@/lib/animation";
import { cn } from "@/lib/utils";
import { PATHWAY_META, type Pathway } from "@/types";

interface TimerRingProps {
  elapsedMs: number;
  totalMs: number;
  overrunMs: number;
  pathway: Pathway;
  warming?: boolean;
  paused: boolean;
  /**
   * Stroke width of the ring. The ring paints just inside the container's
   * border-box; children render in the interior.
   */
  strokeWidth?: number;
  /**
   * Corner radius for the rounded-rect ring path. Matches the container's
   * rounded-xl (0.75rem ≈ 12px) by default.
   */
  cornerRadius?: number;
  className?: string;
  children: React.ReactNode;
}

/**
 * Pathway-tinted ring that bounds a sprint slot and fills as time elapses.
 *
 * The ring lives in a non-clipping <svg> overlay that resizes with the
 * container via ResizeObserver. The path is a rounded rectangle traced
 * along the inside edge so the stroke sits on top of (and replaces) the
 * previous `border-primary/40` chrome.
 *
 * Visual states:
 *   - normal:    pathway stroke, dasharray driven by elapsed / total.
 *   - overrun:   stroke shifts to var(--destructive); a second pass
 *                continues drawing past 360° to communicate "over plan".
 *   - paused:    full ring dims to 50% alpha.
 *   - warming:   a ~30° arc highlight rotates around the perimeter at
 *                1.5s/rev to signal pre-warm in flight.
 *
 * Fill animation runs through `withMotion(() => gsap.to(...))` so users
 * with `prefers-reduced-motion: reduce` jump to the target dashoffset
 * with no tween.
 */
export function TimerRing({
  elapsedMs,
  totalMs,
  overrunMs,
  pathway,
  warming = false,
  paused,
  strokeWidth = 2,
  cornerRadius = 12,
  className,
  children,
}: TimerRingProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const fillRef = useRef<SVGPathElement | null>(null);
  const overrunRef = useRef<SVGPathElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  // ResizeObserver tracks the container so the SVG re-traces when the
  // slot resizes (focus swap, viewport shift). Avoids the SVG ring
  // drifting off the rounded corner.
  useEffect(() => {
    if (!wrapRef.current) return;
    const el = wrapRef.current;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pathData =
    size.w > 0 && size.h > 0
      ? buildRoundedRectPath(size.w, size.h, cornerRadius, strokeWidth)
      : "";
  const perimeter = pathData ? approxRoundedRectPerimeter(size.w, size.h, cornerRadius, strokeWidth) : 0;

  const pct = totalMs > 0 ? Math.min(1, elapsedMs / totalMs) : 0;
  const overrunPct =
    overrunMs > 0 && totalMs > 0 ? Math.min(1, overrunMs / totalMs) : 0;

  // Tween the dashoffset on each elapsedMs change. Using gsap rather than
  // CSS transitions because we want a consistent ease + duration tied to
  // the rest of the app (DUR.short / EASE.out) — and CSS transition would
  // re-fire on every 1s tick, which can produce a stuttery feel.
  useGSAP(
    () => {
      if (!fillRef.current || perimeter === 0) return;
      withMotion(() => {
        gsap.to(fillRef.current, {
          strokeDashoffset: perimeter * (1 - pct),
          duration: DUR.short,
          ease: EASE.out,
          overwrite: "auto",
        });
      });
      // Reduced-motion path: snap to the target with no tween.
      if (
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        fillRef.current.style.strokeDashoffset = String(perimeter * (1 - pct));
      }
    },
    { dependencies: [pct, perimeter] }
  );

  useGSAP(
    () => {
      if (!overrunRef.current || perimeter === 0) return;
      withMotion(() => {
        gsap.to(overrunRef.current, {
          strokeDashoffset: perimeter * (1 - overrunPct),
          duration: DUR.short,
          ease: EASE.out,
          overwrite: "auto",
        });
      });
      if (
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        overrunRef.current.style.strokeDashoffset = String(
          perimeter * (1 - overrunPct)
        );
      }
    },
    { dependencies: [overrunPct, perimeter] }
  );

  const meta = PATHWAY_META[pathway];
  const strokeColor = `hsl(var(${meta.colorVar}))`;
  const destructiveColor = "hsl(var(--destructive))";
  const dimAlpha = paused ? 0.5 : 1;

  return (
    <div
      ref={wrapRef}
      className={cn("relative", className)}
      style={
        {
          ["--ring-color" as string]: strokeColor,
        } as React.CSSProperties
      }
    >
      {children}
      {/* SVG ring overlay — non-interactive, no layout impact. The
          stroke paints inset by half the stroke width so it doesn't get
          clipped by the rounded container or sit outside it. */}
      <svg
        aria-hidden
        className="pointer-events-none absolute inset-0 h-full w-full"
        style={{ opacity: dimAlpha }}
      >
        {pathData && (
          <>
            {/* Track — faint full ring so the dasharray fill reads. */}
            <path
              d={pathData}
              fill="none"
              stroke={strokeColor}
              strokeOpacity={0.18}
              strokeWidth={strokeWidth}
            />
            {/* Fill — pathway tint, dasharray-driven. */}
            <path
              ref={fillRef}
              d={pathData}
              fill="none"
              stroke={overrunMs > 0 ? destructiveColor : strokeColor}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeDasharray={perimeter}
              strokeDashoffset={perimeter}
            />
            {/* Overrun pass — second ring drawn in destructive after the
                first lap completes. */}
            {overrunMs > 0 && (
              <path
                ref={overrunRef}
                d={pathData}
                fill="none"
                stroke={destructiveColor}
                strokeWidth={strokeWidth}
                strokeLinecap="round"
                strokeDasharray={perimeter}
                strokeDashoffset={perimeter}
                strokeOpacity={0.55}
              />
            )}
            {warming && (
              <WarmingArc
                pathData={pathData}
                perimeter={perimeter}
                strokeColor={strokeColor}
                strokeWidth={strokeWidth}
              />
            )}
          </>
        )}
      </svg>
    </div>
  );
}

/**
 * Build a rounded-rectangle path that traces the inside edge of a box
 * with the given size and corner radius, inset by half the stroke
 * width so the stroke sits cleanly inside the container.
 *
 * Starts at the top edge midpoint and goes clockwise so the dasharray
 * fill animates from the top of the slot — visually matches "time
 * draining clockwise".
 */
function buildRoundedRectPath(
  w: number,
  h: number,
  r: number,
  strokeWidth: number
): string {
  const inset = strokeWidth / 2;
  const x0 = inset;
  const y0 = inset;
  const x1 = w - inset;
  const y1 = h - inset;
  const maxR = Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2);
  // Path starts at top edge centre.
  const startX = (x0 + x1) / 2;
  return [
    `M ${startX} ${y0}`,
    `L ${x1 - maxR} ${y0}`,
    `A ${maxR} ${maxR} 0 0 1 ${x1} ${y0 + maxR}`,
    `L ${x1} ${y1 - maxR}`,
    `A ${maxR} ${maxR} 0 0 1 ${x1 - maxR} ${y1}`,
    `L ${x0 + maxR} ${y1}`,
    `A ${maxR} ${maxR} 0 0 1 ${x0} ${y1 - maxR}`,
    `L ${x0} ${y0 + maxR}`,
    `A ${maxR} ${maxR} 0 0 1 ${x0 + maxR} ${y0}`,
    `Z`,
  ].join(" ");
}

function approxRoundedRectPerimeter(
  w: number,
  h: number,
  r: number,
  strokeWidth: number
): number {
  const inset = strokeWidth / 2;
  const innerW = w - 2 * inset;
  const innerH = h - 2 * inset;
  const maxR = Math.min(r, innerW / 2, innerH / 2);
  const straight = 2 * (innerW - 2 * maxR) + 2 * (innerH - 2 * maxR);
  const corners = 2 * Math.PI * maxR;
  return straight + corners;
}

/**
 * A short arc highlight that rotates around the perimeter while the
 * pre-warm agent is in flight. Implemented as a second path with a
 * tiny dasharray gap that we animate via dashoffset on a loop.
 */
function WarmingArc({
  pathData,
  perimeter,
  strokeColor,
  strokeWidth,
}: {
  pathData: string;
  perimeter: number;
  strokeColor: string;
  strokeWidth: number;
}) {
  const arcRef = useRef<SVGPathElement | null>(null);
  // Arc length ≈ 8.3% of perimeter (~30° on a circle). Gap is the rest.
  const arc = perimeter * 0.083;
  const gap = perimeter - arc;
  useGSAP(
    () => {
      if (!arcRef.current) return;
      withMotion(() => {
        gsap.to(arcRef.current, {
          strokeDashoffset: -perimeter,
          duration: 1.5,
          ease: "none",
          repeat: -1,
        });
      });
    },
    { dependencies: [perimeter] }
  );
  return (
    <path
      ref={arcRef}
      d={pathData}
      fill="none"
      stroke={strokeColor}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeDasharray={`${arc} ${gap}`}
      strokeDashoffset={0}
      strokeOpacity={0.95}
    />
  );
}
