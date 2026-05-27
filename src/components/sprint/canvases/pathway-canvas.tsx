"use client";

import type { S2DItem, Pathway } from "@/types";
import { ReplyCanvas } from "./reply-canvas";
import { DecideCanvas } from "./decide-canvas";
import { FocusCard } from "./focus-card";
import { WatchCanvas } from "./watch-canvas";
import { DelegateCanvas } from "./delegate-canvas";
import { MeetingPrepCanvas } from "./meeting-prep-canvas";
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
 * All 7 pathways have a native canvas as of Phase 4. The
 * `<SprintCardWorkspace>` tabbed fallback is gone.
 */
const NATIVE_PATHWAYS: Pathway[] = [
  "quick_reply",
  "drafted_response",
  "decision_gate",
  "heads_down",
  "watching",
  "delegated",
  "meeting_backed",
];

export function isNativePathway(pathway: Pathway): boolean {
  return NATIVE_PATHWAYS.includes(pathway);
}

/**
 * Dispatch a pathway-specific canvas component.
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
      return <FocusCard {...base} />;
    case "watching":
      return <WatchCanvas {...base} />;
    case "delegated":
      return <DelegateCanvas {...base} />;
    case "meeting_backed":
      return <MeetingPrepCanvas {...base} />;
    default:
      return null;
  }
}
