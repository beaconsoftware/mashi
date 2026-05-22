/**
 * MashiMark — the brand logo.
 *
 * A record-disk / bullseye hybrid: a solid black disk centered on the
 * canvas with a small yellow dot in its middle (the spindle), and a
 * series of thin concentric contour rings emerging outward like
 * record grooves / target rings / sound waves.
 *
 * The inner spindle dot is rendered with a mask so it punches through
 * the disk to whatever sits behind the SVG (the yellow brand tile in
 * the sidebar, the favicon's yellow square, etc.) — works on any
 * backdrop without hard-coding the dot color.
 *
 * Single-color via currentColor so disk + rings inherit the parent
 * text color (typically black on the yellow brand tile).
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
      <defs>
        {/* Mask: white everywhere shows the disk, black at the center
            cuts out the spindle. The resulting hole reveals whatever
            background sits behind the SVG. */}
        <mask id="mashi-mark-spindle" maskUnits="userSpaceOnUse">
          <rect width="32" height="32" fill="white" />
          <circle cx="16" cy="16" r="1.6" fill="black" />
        </mask>
      </defs>

      {/* Outer contour rings — thin grooves emerging outward. Opacity
          drops slightly toward the outside so they feel like ripples. */}
      <circle cx="16" cy="16" r="14" strokeWidth="0.9" opacity="0.45" />
      <circle cx="16" cy="16" r="11.5" strokeWidth="0.9" opacity="0.7" />
      <circle cx="16" cy="16" r="9" strokeWidth="0.9" opacity="0.9" />

      {/* Solid disk with the spindle cut out via mask. */}
      <circle
        cx="16"
        cy="16"
        r="6.2"
        fill="currentColor"
        stroke="none"
        mask="url(#mashi-mark-spindle)"
      />
    </svg>
  );
}
