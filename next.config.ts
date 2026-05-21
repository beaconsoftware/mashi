import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow remote images we explicitly use via <Image>. The Spotify player
  // and ambient bg pull album art from Spotify's i.scdn.co CDN; without
  // listing the host here, Image can fail at runtime in production even
  // with the `unoptimized` prop and tear down the React tree.
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "i.scdn.co" },
      { protocol: "https", hostname: "mosaic.scdn.co" },
      { protocol: "https", hostname: "image-cdn-ak.spotifycdn.com" },
      { protocol: "https", hostname: "image-cdn-fa.spotifycdn.com" },
    ],
  },
};

export default nextConfig;
