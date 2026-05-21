"use client";

import { useSprintStore } from "@/store/sprint-store";
import { SprintActiveModeMulti } from "./sprint-active-mode-multi";
import { SprintComplete } from "./sprint-complete";
import { SprintWidget } from "./sprint-widget";

/**
 * Top-level mount in AppShell. The active-mode component renders a fixed
 * overlay only when phase==="active"; the widget renders only when
 * phase==="minimized". Together they make the sprint visible from any
 * page in the dashboard.
 *
 * IMPORTANT: this is the surface that fires when the user starts a sprint
 * from anywhere except /sprint. /sprint's own page renders the same
 * components — both surfaces must mirror its completion-transition logic
 * (when every block is done/skipped, render SprintComplete instead of
 * leaving the user stuck in an empty active overlay).
 */
export function SprintGlobalMount() {
  const phase = useSprintStore((s) => s.phase);
  const blocks = useSprintStore((s) => s.blocks);

  // Mirror sprint-page.tsx: every block settled → show the recap, not the
  // empty active overlay. blocks.length === 0 also counts as settled so
  // SprintComplete renders its no-op state if the user somehow lands here
  // with no plan.
  const allSettled =
    blocks.length === 0 ||
    blocks.every((b) => b.status === "done" || b.status === "skipped");

  return (
    <>
      {phase === "active" && (allSettled ? <SprintComplete /> : <SprintActiveModeMulti />)}
      <SprintWidget />
    </>
  );
}
