import { ImageResponse } from "next/og";

/**
 * Dynamic favicon — record/bullseye mark on the yellow brand tile.
 * Concentric contour rings emerging from a solid black disk with a
 * yellow spindle dot in the center. Next.js handles size resolution.
 */

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

const YELLOW = "hsl(43 96% 56%)";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: YELLOW,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 6,
        }}
      >
        <svg
          viewBox="0 0 32 32"
          width="26"
          height="26"
          fill="none"
          stroke="black"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {/* Outer contour rings */}
          <circle cx="16" cy="16" r="14" strokeWidth="1" opacity="0.45" />
          <circle cx="16" cy="16" r="11.5" strokeWidth="1" opacity="0.7" />
          <circle cx="16" cy="16" r="9" strokeWidth="1" opacity="0.9" />
          {/* Solid black disk */}
          <circle cx="16" cy="16" r="6.2" fill="black" stroke="none" />
          {/* Yellow spindle dot (matches tile bg) */}
          <circle cx="16" cy="16" r="1.6" fill={YELLOW} stroke="none" />
        </svg>
      </div>
    ),
    { ...size }
  );
}
