"use client";

import { useEffect } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThreadView } from "@/components/agent/thread-view";
import { FocusOverlay, Surface } from "@/components/layout/primitives";
import { useS2DItems } from "@/hooks/use-s2d";
import { useAgentThread } from "@/store/agent-thread-store";
import { cn } from "@/lib/utils";
import type { S2DStatus } from "@/types";

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
        <FullscreenChat itemId={itemId} onMinimize={minimizeThread} />
      )}
    </>
  );
}

/**
 * Fullscreen chat surface. Centers a Surface-bound chat panel in the
 * overlay so the chat reads as a contained card rather than disappearing
 * into the void. The panel itself houses three regions:
 *
 *   1. TopBar — MASH-N + title + status, minimize on the right
 *   2. ThreadView — the conversation + composer
 *
 * Layout is constrained to max-w-3xl so the line length stays readable
 * even on ultra-wide displays. Vertical max-h is bounded so the panel
 * doesn't kiss the viewport edges.
 */
function FullscreenChat({
  itemId,
  onMinimize,
}: {
  itemId: string;
  onMinimize: () => void;
}) {
  const { data: items } = useS2DItems();
  const item = (items ?? []).find((i) => i.id === itemId);

  return (
    <FocusOverlay>
      <div className="flex h-full min-h-0 items-center justify-center p-6">
        <Surface
          shadow="md"
          className="flex h-full max-h-[calc(100vh-3rem)] w-full max-w-3xl min-h-0 flex-col overflow-hidden"
        >
          <ChatHeader item={item} itemId={itemId} onMinimize={onMinimize} />
          <div className="flex-1 min-h-0 px-4 pb-4 pt-2">
            <ThreadView itemId={itemId} />
          </div>
        </Surface>
      </div>
    </FocusOverlay>
  );
}

function ChatHeader({
  item,
  itemId,
  onMinimize,
}: {
  item: { ticket_number?: number; title: string; status: S2DStatus } | undefined;
  itemId: string;
  onMinimize: () => void;
}) {
  const ticket =
    item?.ticket_number != null ? `MASH-${item.ticket_number}` : null;
  const title = item?.title ?? "Chat";
  const status = item?.status;
  return (
    <header className="flex items-center gap-3 border-b border-border/40 bg-card/55 px-4 py-2.5">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {ticket && (
          <span className="font-mono text-[11px] text-primary">{ticket}</span>
        )}
        <span className="truncate text-sm font-medium text-foreground">
          {title}
        </span>
        {status && <StatusChip status={status} />}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onMinimize}
        className="mashi-press h-7 gap-1 px-2 text-xs text-muted-foreground"
        title="Minimize (Esc)"
        aria-label={`Minimize chat for ${ticket ?? itemId}`}
      >
        <Minimize2 className="h-3 w-3" />
        Minimize
      </Button>
    </header>
  );
}

const STATUS_TONES: Record<S2DStatus, string> = {
  backlog: "bg-muted/60 text-muted-foreground",
  todo: "bg-secondary/60 text-foreground/80",
  in_progress: "bg-primary/15 text-primary",
  in_queue: "bg-amber-500/15 text-amber-500",
  done: "bg-emerald-500/15 text-emerald-500",
};

const STATUS_LABEL: Record<S2DStatus, string> = {
  backlog: "Backlog",
  todo: "Todo",
  in_progress: "In progress",
  in_queue: "In queue",
  done: "Done",
};

function StatusChip({ status }: { status: S2DStatus }) {
  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider",
        STATUS_TONES[status]
      )}
    >
      {STATUS_LABEL[status]}
    </span>
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
