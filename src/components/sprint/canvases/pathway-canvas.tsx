"use client";

import type { S2DItem, Pathway } from "@/types";
import { ReplyCanvas } from "./reply-canvas";
import { DecideCanvas } from "./decide-canvas";
import type {
  CanvasBaseProps,
  PrewarmState,
  SlotExit,
} from "./_shared/canvas-shell";

export type { CanvasBaseProps, PrewarmState, SlotExit } from "./_shared/canvas-shell";

export interface PathwayCanvasProps {
  item: S2DItem;
  active: boolean;
  prewarm?: PrewarmState;
  onExit: (exit: SlotExit) => Promise<void> | void;
  onOpenDetail?: () => void;
  /**
   * Pathways still served by the legacy tabbed workspace in this phase.
   * The dispatcher returns null for these so the caller falls back to
   * `<SprintCardWorkspace>`. Phases 3–4 remove this fallback.
   */
}

const NATIVE_PATHWAYS: Pathway[] = [
  "quick_reply",
  "drafted_response",
  "decision_gate",
];

export function isNativePathway(pathway: Pathway): boolean {
  return NATIVE_PATHWAYS.includes(pathway);
}

/**
 * Dispatch a pathway-specific canvas component.
 *
 * Phase 2 lands three:
 *   - quick_reply / drafted_response  → ReplyCanvas
 *   - decision_gate                   → DecideCanvas
 *
 * The remaining four (heads_down, meeting_backed, delegated, watching)
 * still flow through the legacy tabbed `<SprintCardWorkspace>`; the
 * caller checks `isNativePathway()` to decide which to render. Phases
 * 3–4 fill in the rest and remove the fallback.
 */
export function PathwayCanvas(props: PathwayCanvasProps) {
  const prewarm: PrewarmState = props.prewarm ?? { status: "pending" };
  const base: CanvasBaseProps = {
    item: props.item,
    active: props.active,
    prewarm,
    onExit: props.onExit,
    onOpenDetail: props.onOpenDetail,
  };
  switch (props.item.pathway) {
    case "quick_reply":
    case "drafted_response":
      return <ReplyCanvas {...base} />;
    case "decision_gate":
      return <DecideCanvas {...base} />;
    default:
      return null;
  }
}
