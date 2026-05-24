/**
 * GET /api/downloads/mac-helper
 *
 * Streams the latest Mac Helper .dmg from the `mac-helper-latest` GitHub
 * Release back to the user. Auth: Mashi's middleware already gates
 * everything except the explicit public path list, so reaching this
 * endpoint at all implies the caller is signed in.
 *
 * Why a proxy instead of a direct GitHub Release link: the repo is
 * private, so GitHub's release-asset URLs require authentication. The
 * Mashi server has a stored GitHub token (`GITHUB_DOWNLOAD_TOKEN`) with
 * read-only access to release assets; the user never sees it.
 */

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OWNER = "sidd-beacon";
const REPO = "mashi";
const RELEASE_TAG = "mac-helper-latest";

export async function GET() {
  // Defensive auth re-check — middleware already gates the route, but
  // belt + suspenders here in case the public-path list ever drifts.
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const token = process.env.GITHUB_DOWNLOAD_TOKEN;
  if (!token) {
    return NextResponse.json(
      {
        error:
          "GITHUB_DOWNLOAD_TOKEN not configured. Set a GitHub PAT with `repo` scope in Vercel env.",
      },
      { status: 503 }
    );
  }

  // 1. Look up the release by tag.
  const relRes = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/releases/tags/${RELEASE_TAG}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "mashi-download-proxy",
      },
    }
  );
  if (!relRes.ok) {
    if (relRes.status === 404) {
      return NextResponse.json(
        {
          error:
            "No Mac Helper build yet. The first build runs ~5 minutes after the workflow is merged to main.",
        },
        { status: 404 }
      );
    }
    return NextResponse.json(
      { error: `GitHub release lookup failed: ${relRes.status}` },
      { status: 502 }
    );
  }
  const release = (await relRes.json()) as {
    assets: Array<{ id: number; name: string; size: number }>;
  };

  // 2. Find the .dmg asset.
  const dmg = release.assets.find((a) => a.name.endsWith(".dmg"));
  if (!dmg) {
    return NextResponse.json(
      { error: "Release exists but contains no .dmg asset" },
      { status: 502 }
    );
  }

  // 3. Stream the asset binary. The /assets/:id endpoint redirects to a
  // signed S3 URL; we follow it server-side and pipe back to the user.
  const assetRes = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/releases/assets/${dmg.id}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/octet-stream",
        "User-Agent": "mashi-download-proxy",
      },
    }
  );
  if (!assetRes.ok || !assetRes.body) {
    return NextResponse.json(
      { error: `GitHub asset download failed: ${assetRes.status}` },
      { status: 502 }
    );
  }

  return new Response(assetRes.body, {
    status: 200,
    headers: {
      "Content-Type": "application/x-apple-diskimage",
      "Content-Disposition": `attachment; filename="${dmg.name}"`,
      "Content-Length": String(dmg.size),
      "Cache-Control": "no-store",
    },
  });
}
