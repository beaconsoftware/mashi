"use client";

import { SprintActiveMode } from "./sprint-active-mode";
import { SprintWidget } from "./sprint-widget";

/**
 * Top-level mount in AppShell. The active-mode component renders a fixed
 * overlay only when phase==="active"; the widget renders only when
 * phase==="minimized". Together they make the sprint visible from any
 * page in the dashboard.
 */
export function SprintGlobalMount() {
  return (
    <>
      <SprintActiveMode />
      <SprintWidget />
    </>
  );
}
