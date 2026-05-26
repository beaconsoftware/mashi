"use client";

import type { S2DItem, Pathway } from "@/types";
import { ReplyCanvas } from "./reply-canvas";
import { DecideCanvas } from "./decide-canvas";
import { HeadsDownCanvas } from "./heads-down-canvas";
import { WatchCanvas } from "./watch-canvas";
import { DelegateCanvas } from "./delegate-canvas";
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
}

/**
 * The set of pathways with a native canvas. Phase 4 adds `meeting_backed`
 * and deletes `<SprintCardWorkspace>` entirely.
 */
const NATIVE_PATHWAYS: Pathway[] = [
  "quick_reply",
  "drafted_response",
  "decision_gate",
  "heads_down",
  "watching",
  "delegated",
];

export function isNativePathway(pathway: Pathway): boolean {
  return NATIVE_PATHWAYS.includes(pathway);
}

/**
 * Dispatch a pathway-specific canvas component.
 *
 * Phase 3 lands the remaining three action-shaped pathways:
 *   - heads_down  → HeadsDownCanvas
 *   - watching    → WatchCanvas
 *   - delegated   → DelegateCanvas
 *
 * The one remaining pathway (`meeting_backed`) still falls through to
 * the legacy tabbed `<SprintCardWorkspace>` via `isNativePathway()`
 * returning false; Phase 4 ports it and deletes the fallback.
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
    case "heads_down":
      return <HeadsDownCanvas {...base} />;
    case "watching":
      return <WatchCanvas {...base} />;
    case "delegated":
      return <DelegateCanvas {...base} />;
    default:
      return null;
  }
}
