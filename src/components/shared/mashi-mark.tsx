/**
 * MashiMark — the brand logo.
 *
 * A minimalist torch: a white flame with a short rectangular handle.
 * The apex of the flame is slightly right of center to suggest
 * windblown motion without ornamentation.
 *
 * The mark is intentionally simple and renders cleanly from favicon
 * scale (16-32px) up through hero-tile scale (48-64px). The whole
 * mark is white via `currentColor`, so it inherits the parent text
 * color — drop it inside a `bg-primary text-primary-foreground` tile
 * and it picks up the right color automatically (white in dark mode).
 *
 * Matches the favicon at `src/app/icon.tsx` — same flame path, same
 * handle, same tile color (UI Primary blue).
 */
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
      fill="currentColor"
      stroke="none"
    >
      {/* Flame — asymmetric teardrop. Apex starts at x=17 (slightly
          right of center) to suggest a wind-tilted top edge. The
          lower curves narrow back toward the handle. */}
      <path d="M17 5 C 12 10, 9 16, 12 22 C 13 25, 15 25.5, 16 25 C 17 25.5, 19 25, 20 22 C 23 16, 22 9, 17 5 Z" />

      {/* Handle — gently curved so it reads as a torch leaning
          forward (the carrier mid-stride) rather than an upright
          candle. Both side edges bow ~1 unit to the right; the
          bottom of the handle is offset right of the top. Same
          vertical span as the prior rect. */}
      <path d="M14 25.5 C14 25, 14.5 25, 15 25 L17 25 C17.5 25, 18 25, 18 25.5 C18.2 27, 19 29.5, 19 30.5 C19 31, 18.5 31, 18 31 L16 31 C15.5 31, 15 31, 15 30.5 C15 29.5, 14.2 27, 14 25.5 Z" />
    </svg>
  );
}
