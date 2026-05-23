import { ImageResponse } from "next/og";

/**
 * Dynamic favicon — record-disk / sonar-target mark on the Beacon
 * Blue brand tile. Black disk inside the tile, WHITE concentric arc
 * reverberations + WHITE spindle dot inside the disk.
 *
 * Tile color is Brand Blue (#09377E, HSL 217 87% 26%), the standalone
 * Beacon mark color. The disk reverberations and spindle use white so
 * the mark reads with maximum contrast on browser chrome regardless
 * of tab color or OS theme. The in-app UI primary is a brighter blue
 * (HSL 217 91% 53%) used for `--primary` / `bg-primary`; the favicon
 * stands alone on browser chrome so it uses the deeper brand value
 * for the tile.
 */

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

const BRAND_BLUE = "hsl(217 87% 26%)";
const WHITE = "hsl(0 0% 100%)";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: BRAND_BLUE,
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
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {/* Solid black disk — fills most of the tile. */}
          <circle cx="16" cy="16" r="13.5" fill="black" stroke="none" />

          {/* Uneven white reverberation rings inside the disk. */}
          <circle
            cx="16"
            cy="16"
            r="10.5"
            stroke={WHITE}
            strokeWidth="0.9"
            strokeDasharray="9 5 14 4 7 6"
            opacity="0.55"
            transform="rotate(12 16 16)"
          />
          <circle
            cx="16"
            cy="16"
            r="8"
            stroke={WHITE}
            strokeWidth="1"
            strokeDasharray="11 4 6 5 16 3"
            opacity="0.75"
            transform="rotate(-30 16 16)"
          />
          <circle
            cx="16"
            cy="16"
            r="5.5"
            stroke={WHITE}
            strokeWidth="1.1"
            strokeDasharray="14 3 9 4"
            opacity="0.95"
            transform="rotate(48 16 16)"
          />

          {/* White spindle dot — the bullseye. */}
          <circle cx="16" cy="16" r="1.7" fill={WHITE} stroke="none" />
        </svg>
      </div>
    ),
    { ...size }
  );
}
