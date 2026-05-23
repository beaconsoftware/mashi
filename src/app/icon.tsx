import { ImageResponse } from "next/og";

/**
 * Dynamic favicon — record-disk / sonar-target mark.
 *
 * Tile color is UI Primary blue (HSL 217 91% 53%) — the SAME color as
 * the in-app logo tile (`bg-primary`) so the favicon and the sidebar
 * mark read as one identity. Previously the favicon used the deeper
 * Beacon Brand Blue (#09377E, HSL 217 87% 26%) under the theory that
 * a standalone surface needs higher contrast against light browser
 * chrome, but in practice the visual mismatch with the in-app logo
 * was more jarring than any contrast win.
 *
 * Brand Blue is still the canonical Beacon color for marketing /
 * print surfaces; in-product (favicon + sidebar + sign-in tile) we
 * use the brighter UI Primary for consistency.
 *
 * Black disk inside the tile, WHITE concentric reverberation rings +
 * WHITE spindle dot for max contrast against the black disk.
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
