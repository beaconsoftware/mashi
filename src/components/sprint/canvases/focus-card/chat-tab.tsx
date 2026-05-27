"use client";

import { ThreadView } from "@/components/agent/thread-view";

/**
 * Chat tab — embeds the persistent per-item agent thread inline. Same
 * thread the Ask Mashi bottom-sheet binds to (one thread per item), so
 * messages typed here show up everywhere the user re-opens the thread.
 *
 * ThreadView includes its own composer.
 */
export function ChatTab({ itemId }: { itemId: string }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ThreadView itemId={itemId} />
    </div>
  );
}
