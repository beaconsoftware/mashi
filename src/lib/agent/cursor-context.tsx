"use client";

import { createContext, useContext, useMemo } from "react";
import { usePathname, useParams } from "next/navigation";
import { useSprintStore } from "@/store/sprint-store";
import { useRefineSheet } from "@/store/refine-sheet-store";
import type { CursorContext } from "@/lib/agent/types";

/**
 * Cursor context — assembled client-side from existing stores + the
 * router. Phase 2's agent loop will read this on every turn and pass
 * it to the server as a system message so "what about this one?"
 * works without the user naming the item.
 *
 * No new state here — we only compose what other stores already track.
 * That means: no race against drag-and-drop, sprint state, or sheet
 * open/close.
 */

const CursorContextReact = createContext<CursorContext | null>(null);

export function CursorContextProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? "/";
  const params = useParams();
  // Sprint store — focused slot, queued ids. The refine-sheet binding is
  // the most reliable "user is looking at THIS item" signal we have today.
  const phase = useSprintStore((s) => s.phase);
  const focusedSlotId = useSprintStore((s) => s.focusedSlotId);
  const activeSlotIds = useSprintStore((s) => s.activeSlotIds);
  const blocks = useSprintStore((s) => s.blocks);
  const refineOpen = useRefineSheet((s) => s.open);
  const refineBoundItemId = useRefineSheet((s) => s.boundItemId);

  const value = useMemo<CursorContext>(() => {
    // Route param item id — most pages expose the focused item via
    // params.id (e.g. /s2d/[id], /board/[id]). Falls back to the
    // refine-sheet binding, then the sprint focused slot.
    const routeItemId =
      typeof params?.id === "string" ? (params.id as string) : undefined;
    const focusedItemId =
      routeItemId ?? (refineOpen ? refineBoundItemId ?? undefined : undefined) ?? focusedSlotId ?? undefined;

    const sprintEngaged =
      phase === "active" ||
      phase === "minimized" ||
      phase === "contract" ||
      phase === "prioritize" ||
      phase === "schedule" ||
      phase === "review";

    const queueItemIds = sprintEngaged
      ? blocks
          .filter(
            (b) =>
              b.status !== "done" &&
              b.status !== "skipped" &&
              !activeSlotIds.includes(b.s2dItemId)
          )
          .map((b) => b.s2dItemId)
      : [];

    const openSheet: CursorContext["openSheet"] = refineOpen ? "refine" : null;

    return {
      route: pathname,
      focusedItemId,
      activeSprint: sprintEngaged
        ? {
            focusedSlotItemId: focusedSlotId ?? undefined,
            queueItemIds,
          }
        : undefined,
      openSheet,
      now: new Date().toISOString(),
    };
  }, [
    pathname,
    params,
    phase,
    focusedSlotId,
    activeSlotIds,
    blocks,
    refineOpen,
    refineBoundItemId,
  ]);

  return (
    <CursorContextReact.Provider value={value}>
      {children}
    </CursorContextReact.Provider>
  );
}

/** Read the latest cursor snapshot. Returns a minimal default outside
 * the provider so server-rendered components don't blow up. */
export function useCursorContext(): CursorContext {
  const ctx = useContext(CursorContextReact);
  if (ctx) return ctx;
  return { route: "/", now: new Date().toISOString() };
}

/**
 * Serialize a cursor snapshot for the agent's system prompt. Kept
 * stable + line-oriented so the model can parse it cheaply.
 */
export function serializeCursor(c: CursorContext): string {
  const parts: string[] = [];
  parts.push(`route=${c.route}`);
  parts.push(`now=${c.now}`);
  if (c.focusedItemId) parts.push(`focused_item_id=${c.focusedItemId}`);
  if (c.selectedItemIds?.length) {
    parts.push(`selected_item_ids=[${c.selectedItemIds.join(",")}]`);
  }
  if (c.openSheet) parts.push(`open_sheet=${c.openSheet}`);
  if (c.activeSprint) {
    if (c.activeSprint.focusedSlotItemId) {
      parts.push(`sprint_focused_slot=${c.activeSprint.focusedSlotItemId}`);
    }
    if (c.activeSprint.queueItemIds.length) {
      parts.push(
        `sprint_queue=[${c.activeSprint.queueItemIds.join(",")}]`
      );
    }
  }
  if (c.recentlyViewedItemIds?.length) {
    parts.push(`recent=[${c.recentlyViewedItemIds.join(",")}]`);
  }
  return parts.join("\n");
}
