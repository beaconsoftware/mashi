/**
 * Tiny env-var-driven feature flag layer.
 *
 * We didn't have a flag system before this. Keep it dead simple until we
 * actually need percentage rollouts / per-user gates: read a comma-separated
 * `NEXT_PUBLIC_FEATURE_FLAGS` env var, check membership.
 *
 * Usage (client OR server):
 *   import { isFeatureEnabled } from "@/lib/feature-flags";
 *   if (isFeatureEnabled("activity_watcher")) { ... }
 *
 * To enable locally, add to .env.local:
 *   NEXT_PUBLIC_FEATURE_FLAGS=activity_watcher
 *
 * NEXT_PUBLIC_* is required so client components can read it without an
 * extra round-trip.
 */

export type FeatureFlag = "activity_watcher";

function readEnabledFlags(): Set<string> {
  const raw = process.env.NEXT_PUBLIC_FEATURE_FLAGS ?? "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

export function isFeatureEnabled(flag: FeatureFlag): boolean {
  return readEnabledFlags().has(flag);
}
