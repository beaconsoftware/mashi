"use client";

import { create } from "zustand";

/**
 * Spawned-rail store (Phase 2 scaffold).
 *
 * The sprint takeover collects artifacts produced by slot exits — sent
 * replies, recorded decisions, spawned follow-up items, watch check-ins,
 * delegate nudges, staged meetings — and surfaces them in a bottom strip
 * (rendered in Phase 5).
 *
 * Phase 2 lands the store + push helper so the Reply / Decide canvases
 * can already emit artifacts on exit. The UI strip itself ships in
 * Phase 5; until then, the list is intentionally inert (no DOM, no
 * persistence — it lives in-memory for the duration of a sprint).
 */

export type SpawnedArtifactKind =
  | "sent"
  | "decision"
  | "follow-up"
  | "check-in"
  | "nudge"
  | "staged-meeting";

export interface SpawnedArtifact {
  id: string;
  kind: SpawnedArtifactKind;
  /** Item the artifact was produced FROM. */
  itemId?: string;
  /** Item the artifact CREATED, when applicable (follow-ups). */
  spawnedItemId?: string;
  label: string;
  detail: string;
  at: string;
}

interface SpawnedRailState {
  artifacts: SpawnedArtifact[];
  push: (artifact: Omit<SpawnedArtifact, "id" | "at"> & { at?: string }) => void;
  clear: () => void;
}

function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `art_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export const useSpawnedRail = create<SpawnedRailState>((set) => ({
  artifacts: [],
  push: (artifact) =>
    set((s) => ({
      artifacts: [
        ...s.artifacts,
        {
          id: makeId(),
          at: artifact.at ?? new Date().toISOString(),
          ...artifact,
        },
      ],
    })),
  clear: () => set({ artifacts: [] }),
}));
