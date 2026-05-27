"use client";

import { useEffect } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThreadView } from "@/components/agent/thread-view";
import { FocusOverlay } from "@/components/layout/primitives";
import { useAgentThread } from "@/store/agent-thread-store";

/**
 * Chat tab — embeds the persistent per-item agent thread inline. Same
 * thread the Ask Mashi bottom-sheet binds to (one thread per item), so
 * messages typed here show up everywhere the user re-opens the thread.
 *
 * ThreadView includes its own composer.
 *
 * Fullscreen mode: clicking Expand promotes the thread into a
 * FocusOverlay (single overlay portal per AGENTS.md). The slot then
 * renders a small placeholder so the slot's owner doesn't render a
 * second mount of <ThreadView> — only one client subscribes to the SSE
 * stream at a time. Esc minimizes before sprint mode's Esc handler fires.
 */
export function ChatTab({ itemId }: { itemId: string }) {
  const key = `item:${itemId}`;
  const expandedThreadKey = useAgentThread((s) => s.expandedThreadKey);
  const expandThread = useAgentThread((s) => s.expandThread);
  const minimizeThread = useAgentThread((s) => s.minimizeThread);
  const isExpanded = expandedThreadKey === key;

  // Capture-phase Esc: minimizes before sprint mode's window-level
  // Escape handler (which would otherwise close the detail panel,
  // sliding the user back to the sprint board mid-conversation).
  useEffect(() => {
    if (!isExpanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        minimizeThread();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKey, { capture: true });
  }, [isExpanded, minimizeThread]);

  return (
    <>
      {isExpanded ? (
        <SlotPlaceholder onRestore={minimizeThread} />
      ) : (
        <div className="flex h-full min-h-0 flex-col">
          <div className="mb-1.5 flex items-center justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => expandThread(key)}
              className="mashi-press h-6 gap-1 px-2 text-[11px] text-muted-foreground"
              title="Expand chat (Esc to minimize)"
            >
              <Maximize2 className="h-3 w-3" />
              Expand
            </Button>
          </div>
          <div className="flex-1 min-h-0">
            <ThreadView itemId={itemId} />
          </div>
        </div>
      )}
      {isExpanded && (
        <FocusOverlay>
          <div className="flex h-full min-h-0 flex-col gap-2 p-6">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Chat
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={minimizeThread}
                className="mashi-press h-7 gap-1 px-2 text-xs text-muted-foreground"
                title="Minimize (Esc)"
              >
                <Minimize2 className="h-3 w-3" />
                Minimize
              </Button>
            </div>
            <div className="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-1 flex-col">
              <ThreadView itemId={itemId} />
            </div>
          </div>
        </FocusOverlay>
      )}
    </>
  );
}

function SlotPlaceholder({ onRestore }: { onRestore: () => void }) {
  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border/40 bg-card/60 p-4 text-center text-xs text-muted-foreground">
      <p>Chat is open fullscreen.</p>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onRestore}
        className="mashi-press h-7 gap-1 px-2 text-xs"
      >
        <Minimize2 className="h-3 w-3" />
        Restore here
      </Button>
    </div>
  );
}
