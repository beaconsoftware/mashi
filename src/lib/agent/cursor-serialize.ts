import type { CursorContext } from "@/lib/agent/types";

/**
 * Serialize a cursor snapshot for the agent's system prompt. Kept
 * stable + line-oriented so the model can parse it cheaply.
 *
 * Lives in a plain .ts module (no "use client") so the server-side
 * agent loop can import it. The matching `useCursorContext` hook is
 * the client-side counterpart in `cursor-context.tsx`.
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
      parts.push(`sprint_queue=[${c.activeSprint.queueItemIds.join(",")}]`);
    }
  }
  if (c.recentlyViewedItemIds?.length) {
    parts.push(`recent=[${c.recentlyViewedItemIds.join(",")}]`);
  }
  return parts.join("\n");
}
