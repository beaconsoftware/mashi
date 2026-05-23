/**
 * MashiMark — the brand logo.
 *
 * A record / sonar-target hybrid. Composition:
 *   - Large solid black disk centered on the canvas (the "vinyl").
 *   - Blue center dot (the spindle / bullseye).
 *   - Blue concentric contour rings INSIDE the black disk,
 *     radiating outward from the dot like uneven sound reverberations.
 *     Each ring is an arc-with-gaps (varying stroke-dasharray) so the
 *     rings feel like a live audio waveform rather than a perfect
 *     target.
 *
 * Blue accents are hardcoded to Brand Blue (Beacon #09377E) so the mark
 * reads the same whatever surface it sits on. The black disk is
 * currentColor so the disk recolors naturally when nested in a
 * non-default-text environment.
 */

const BRAND_BLUE = "hsl(217 87% 26%)";

export function MashiMark({
  size = 24,
  className,
  title = "Mashi",
}: {
  size?: number;
  className?: string;
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={title}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Solid black disk — the body of the mark. */}
      <circle cx="16" cy="16" r="13.5" fill="currentColor" stroke="none" />

      {/* Blue reverberation rings inside the disk. Each ring uses a
          distinct stroke-dasharray + rotation so the gaps fall at
          different angular positions — reads as a live waveform with
          uneven peaks instead of a clean concentric target. */}
      <g stroke={BRAND_BLUE} fill="none" strokeLinecap="round">
        <circle
          cx="16"
          cy="16"
          r="10.5"
          strokeWidth="0.9"
          strokeDasharray="9 5 14 4 7 6"
          opacity="0.55"
          transform="rotate(12 16 16)"
        />
        <circle
          cx="16"
          cy="16"
          r="8"
          strokeWidth="1"
          strokeDasharray="11 4 6 5 16 3"
          opacity="0.75"
          transform="rotate(-30 16 16)"
        />
        <circle
          cx="16"
          cy="16"
          r="5.5"
          strokeWidth="1.1"
          strokeDasharray="14 3 9 4"
          opacity="0.95"
          transform="rotate(48 16 16)"
        />
      </g>

      {/* Blue center dot — the bullseye. */}
      <circle cx="16" cy="16" r="1.7" fill={BRAND_BLUE} stroke="none" />
    </svg>
  );
}
