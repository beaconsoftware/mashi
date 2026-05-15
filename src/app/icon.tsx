import { ImageResponse } from "next/og";

/**
 * Dynamic favicon — the same four-jhaadu-M mark, rendered on a primary
 * background. Replaces the legacy src/app/favicon.ico Next.js gets the
 * sizes right automatically.
 */

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "hsl(43 96% 56%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 6,
        }}
      >
        <svg
          viewBox="0 0 32 32"
          width="22"
          height="22"
          fill="none"
          stroke="black"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 5 V18" strokeWidth="2.5" />
          <path d="M5 5 L16 17" strokeWidth="2.5" />
          <path d="M27 5 L16 17" strokeWidth="2.5" />
          <path d="M27 5 V18" strokeWidth="2.5" />
          <circle cx="5" cy="5" r="1.6" fill="black" stroke="none" />
          <circle cx="27" cy="5" r="1.6" fill="black" stroke="none" />
          <path d="M5 19 L5 25" strokeWidth="1.2" />
          <path d="M16 18 L16 25" strokeWidth="1.2" />
          <path d="M27 19 L27 25" strokeWidth="1.2" />
        </svg>
      </div>
    ),
    { ...size }
  );
}
