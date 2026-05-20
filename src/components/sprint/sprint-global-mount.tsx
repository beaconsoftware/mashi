"use client";

import { useSprintStore } from "@/store/sprint-store";
import { SprintActiveModeMulti } from "./sprint-active-mode-multi";
import { SprintWidget } from "./sprint-widget";

/**
 * Top-level mount in AppShell. The active-mode component renders a fixed
 * overlay only when phase==="active"; the widget renders only when
 * phase==="minimized". Together they make the sprint visible from any
 * page in the dashboard.
 *
 * IMPORTANT: this is the surface that fires when the user starts a sprint
 * from anywhere except /sprint (home cockpit "Start sprint", widget
 * "Resume", etc). Previously rendered the legacy single-focus
 * SprintActiveMode regardless of what /sprint did — so opening the sprint
 * from /sprint showed the new multi-active UI but opening from elsewhere
 * still showed the old single-card UI. Both surfaces now render the same
 * multi-active component. The active-mode component itself short-circuits
 * to null when phase isn't active, so it's safe to mount unconditionally.
 */
export function SprintGlobalMount() {
  const phase = useSprintStore((s) => s.phase);
  return (
    <>
      {phase === "active" && <SprintActiveModeMulti />}
      <SprintWidget />
    </>
  );
}
