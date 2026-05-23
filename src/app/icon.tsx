import { ImageResponse } from "next/og";

/**
 * Dynamic favicon — minimalist torch on the UI Primary blue tile.
 *
 * A simple white flame with a short rectangular handle at the base.
 * Asymmetric apex (the highest point is slightly right of center)
 * gives the flame a subtle windblown character without ornamentation.
 *
 * Tile = `--primary` (HSL 217 91% 53%) so the favicon matches the
 * in-app sidebar logo + sign-in tile. Flame + handle are pure white
 * for max contrast at any browser-chrome theme.
 */

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

const UI_PRIMARY = "hsl(217 91% 53%)";
const WHITE = "hsl(0 0% 100%)";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: UI_PRIMARY,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 6,
        }}
      >
        <svg viewBox="0 0 32 32" width="22" height="22" fill={WHITE} stroke="none">
          {/* Flame — asymmetric teardrop. Apex starts at x=17 (slightly
              right of center) to suggest a wind-tilted top edge. The
              lower curves narrow back toward the handle. */}
          <path d="M17 5 C 12 10, 9 16, 12 22 C 13 25, 15 25.5, 16 25 C 17 25.5, 19 25, 20 22 C 23 16, 22 9, 17 5 Z" />

          {/* Handle — short rounded rectangle below the flame. Kept
              compact so the flame dominates at favicon scale. */}
          <rect x="14" y="25" width="4" height="3" rx="1" />
        </svg>
      </div>
    ),
    { ...size }
  );
}
