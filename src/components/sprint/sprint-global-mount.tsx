"use client";

import { usePathname } from "next/navigation";
import { useSprintStore } from "@/store/sprint-store";
import { FocusOverlay } from "@/components/layout/primitives";
import { SprintActiveModeMulti } from "./sprint-active-mode-multi";
import { SprintComplete } from "./sprint-complete";
import { SprintWidget } from "./sprint-widget";

/**
 * Top-level mount in AppShell. ROUTES the active sprint surface to the
 * #mashi-overlay-root portal so the focus takeover sits above page
 * content on every route. SprintActiveModeMulti owns its own portal
 * mount (via the FocusOverlay primitive); SprintComplete is page-shaped
 * (no fixed shell) so we wrap it in FocusOverlay here.
 *
 * Two structural rules baked in here so we don't repeat the
 * SprintComplete double-mount post-mortem:
 *
 *   1. SprintGlobalMount NEVER renders an active sprint surface on
 *      /sprint. The /sprint page renders its own copy inline. Mounting
 *      both surfaces simultaneously double-instantiates SprintComplete
 *      and the two side-effecting copies race each other (POST
 *      /api/sprint/session, exitSprint reset), making the recap flash
 *      and disappear.
 *   2. SprintGlobalMount is a ROUTER — it never renders an overlay
 *      directly. Each overlay either portals itself (Multi) or is
 *      wrapped in FocusOverlay here (Complete). Future focus modes
 *      follow the same pattern.
 *
 * On non-/sprint routes:
 *  - phase==="active" + allSettled → SprintComplete (in portal)
 *  - phase==="active" otherwise    → SprintActiveModeMulti (own portal)
 *  - phase==="minimized"           → handled by SprintWidget below
 */
export function SprintGlobalMount() {
  const pathname = usePathname();
  const phase = useSprintStore((s) => s.phase);
  const blocks = useSprintStore((s) => s.blocks);

  // The /sprint route renders its own copy of these. Skipping them here
  // avoids the double-mount race.
  const onSprintRoute = pathname === "/sprint";

  const allSettled =
    blocks.length === 0 ||
    blocks.every((b) => b.status === "done" || b.status === "skipped");

  const showOverlay = !onSprintRoute && phase === "active";

  return (
    <>
      {showOverlay &&
        (allSettled ? (
          <FocusOverlay>
            <SprintComplete />
          </FocusOverlay>
        ) : (
          // SprintActiveModeMulti wraps itself in FocusOverlay internally.
          <SprintActiveModeMulti />
        ))}
      <SprintWidget />
    </>
  );
}
