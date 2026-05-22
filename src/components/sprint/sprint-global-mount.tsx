"use client";

import { usePathname } from "next/navigation";
import { useSprintStore } from "@/store/sprint-store";
import { SprintActiveModeMulti } from "./sprint-active-mode-multi";
import { SprintComplete } from "./sprint-complete";
import { SprintWidget } from "./sprint-widget";

/**
 * Top-level mount in AppShell. Renders the sprint surface on EVERY route
 * EXCEPT /sprint itself — which has its own page-level renderer that
 * already handles active / minimized / complete state. Mounting both
 * surfaces simultaneously double-instantiates SprintComplete on sprint
 * end and the two side-effecting copies race each other (POST
 * /api/sprint/session, exitSprint reset), making the recap flash and
 * disappear.
 *
 * On non-/sprint routes:
 *  - phase==="active" + allSettled → SprintComplete (recap recap)
 *  - phase==="active" otherwise    → SprintActiveModeMulti overlay
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

  return (
    <>
      {!onSprintRoute &&
        phase === "active" &&
        (allSettled ? <SprintComplete /> : <SprintActiveModeMulti />)}
      <SprintWidget />
    </>
  );
}
