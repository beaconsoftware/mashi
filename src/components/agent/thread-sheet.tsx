"use client";

import { useMemo } from "react";
import { Sparkles } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useAgentThread } from "@/store/agent-thread-store";
import { useS2DItems } from "@/hooks/use-s2d";
import { ThreadView } from "@/components/agent/thread-view";

/**
 * Global agent thread sheet — one instance lives in AppShell. Any
 * caller opens it for a given item via
 * `useAgentThread.openFor(itemId)`. Shadcn Sheet slides up from the
 * bottom (`side="bottom"`) so the user keeps the page context visible
 * behind it.
 *
 * Single owner per AppShell ensures we never double-mount the agent
 * thread surface — same rule as the FocusOverlay portal doctrine in
 * AGENTS.md.
 */
export function AgentThreadSheet() {
  const open = useAgentThread((s) => s.open);
  const itemId = useAgentThread((s) => s.itemId);
  const close = useAgentThread((s) => s.close);
  const { data: items } = useS2DItems();
  const item = useMemo(
    () => (itemId ? items?.find((i) => i.id === itemId) : null),
    [itemId, items]
  );

  return (
    <Sheet open={open} onOpenChange={(v) => (v ? null : close())}>
      <SheetContent
        side="bottom"
        className="z-modal max-h-[75vh] bg-card/95 backdrop-blur-sm"
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 text-sm">
            <Sparkles className="h-4 w-4 text-primary" />
            Ask Mashi
            {item && (
              <span className="ml-1 truncate text-xs font-normal text-muted-foreground">
                · MASH-{item.ticket_number} {item.title}
              </span>
            )}
          </SheetTitle>
          <SheetDescription>
            One persistent conversation per item. Persists across
            sprints and sessions.
          </SheetDescription>
        </SheetHeader>

        {item ? (
          <div className="flex h-[calc(75vh-110px)] min-h-0 flex-col p-5 pt-2">
            <ThreadView itemId={item.id} key={item.id} />
          </div>
        ) : (
          <div className="p-5 pt-2 text-[12px] text-muted-foreground">
            No item bound — open this from the board or detail sheet.
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
