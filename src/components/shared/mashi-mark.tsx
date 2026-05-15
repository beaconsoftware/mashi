/**
 * MashiMark — the brand logo.
 *
 * Four jhaadus (Indian brooms) standing in a row whose handles outline an M:
 * two outer brooms stand straight, two inner brooms lean inward forming the
 * downward V in the middle. Each broom has a bound top knot (the binding
 * that ties the bristles to the handle) and a fan of bristles at the
 * bottom. Single-color via currentColor so it inherits whatever the
 * parent text color is.
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
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Four broom handles — outline an M. Outer two vertical; inner two
          lean inward and meet at the bottom-center apex of the M's V. */}
      {/* Outer left */}
      <path d="M5 5 V18" strokeWidth="2" />
      {/* Inner left — top-left corner down to center-middle */}
      <path d="M5 5 L16 17" strokeWidth="2" />
      {/* Inner right — top-right corner down to center-middle */}
      <path d="M27 5 L16 17" strokeWidth="2" />
      {/* Outer right */}
      <path d="M27 5 V18" strokeWidth="2" />

      {/* Top binding knots — small dots at the top of each handle */}
      <circle cx="5" cy="5" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="27" cy="5" r="1.4" fill="currentColor" stroke="none" />

      {/* Bristle binding rings — short tick across each handle where the
          rope wraps just above the bristles. Sells the "broom" read. */}
      <path d="M3.5 18 H6.5" strokeWidth="1.2" />
      <path d="M14 17 H18" strokeWidth="1.2" />
      <path d="M25.5 18 H28.5" strokeWidth="1.2" />

      {/* Bristle fans — three clusters at the bottom (outer-left,
          center where two inner handles meet, outer-right). Each cluster
          is 3 thin diverging strokes. */}
      {/* Left fan */}
      <path d="M3.5 19 L2.5 25" strokeWidth="1" opacity="0.85" />
      <path d="M5 19 L5 25.5" strokeWidth="1" opacity="0.85" />
      <path d="M6.5 19 L7.5 25" strokeWidth="1" opacity="0.85" />

      {/* Center fan (two brooms share this) */}
      <path d="M14 18 L13 25" strokeWidth="1" opacity="0.85" />
      <path d="M16 18 L16 25.5" strokeWidth="1" opacity="0.85" />
      <path d="M18 18 L19 25" strokeWidth="1" opacity="0.85" />

      {/* Right fan */}
      <path d="M25.5 19 L24.5 25" strokeWidth="1" opacity="0.85" />
      <path d="M27 19 L27 25.5" strokeWidth="1" opacity="0.85" />
      <path d="M28.5 19 L29.5 25" strokeWidth="1" opacity="0.85" />
    </svg>
  );
}
