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

      {/* Handle — longer rounded rectangle below the flame so the
          torch reads as something you'd hold. Spans roughly 25% of
          the icon height. */}
      <rect x="14" y="25" width="4" height="6" rx="1" />
    </svg>
  );
}
