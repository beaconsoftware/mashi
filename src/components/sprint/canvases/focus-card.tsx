"use client";

import { useState } from "react";
import { ListChecks, MessagesSquare, Layers } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CanvasShell, type CanvasBaseProps } from "./_shared/canvas-shell";
import { PlanTab } from "./focus-card/plan-tab";
import { ChatTab } from "./focus-card/chat-tab";
import { ContextTab } from "./focus-card/context-tab";

/**
 * FocusCard — Phase 8. Replaces the legacy heads-down canvas with a
 * three-tab surface (Plan / Chat / Context) where the persistent
 * per-item agent thread is the centerpiece. Defaults to Chat so the
 * conversation is the first thing the user lands in; the user-owned
 * checklist and read-only sources sit one click away.
 *
 * The canvas footer is hidden entirely — the SlotCard already owns the
 * Done/Skip/Bench/Snooze/Detail row, and the Chat tab IS the refine
 * surface so the Ask Mashi chip would just summon a redundant bottom
 * sheet.
 */

type FocusTab = "plan" | "chat" | "context";

export function FocusCard({
  item,
  active,
  prewarm,
  onExit,
  onOpenDetail,
}: CanvasBaseProps) {
  const [tab, setTab] = useState<FocusTab>("chat");

  return (
    <CanvasShell
      item={item}
      active={active}
      prewarm={prewarm}
      onExit={onExit}
      onOpenDetail={onOpenDetail}
      hideFooter
    >
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as FocusTab)}
        className="flex h-full min-h-0 flex-col gap-2"
      >
        <TabsList className="self-start">
          <TabsTrigger value="plan" className="text-[11px]">
            <ListChecks className="h-3 w-3" />
            Plan
          </TabsTrigger>
          <TabsTrigger value="chat" className="text-[11px]">
            <MessagesSquare className="h-3 w-3" />
            Chat
          </TabsTrigger>
          <TabsTrigger value="context" className="text-[11px]">
            <Layers className="h-3 w-3" />
            Context
          </TabsTrigger>
        </TabsList>
        <TabsContent
          value="plan"
          className="min-h-0 flex-1 overflow-y-auto"
          forceMount
          hidden={tab !== "plan"}
        >
          <PlanTab item={item} />
        </TabsContent>
        <TabsContent
          value="chat"
          className="min-h-0 flex-1"
          forceMount
          hidden={tab !== "chat"}
        >
          <ChatTab itemId={item.id} />
        </TabsContent>
        <TabsContent
          value="context"
          className="min-h-0 flex-1 overflow-y-auto"
          forceMount
          hidden={tab !== "context"}
        >
          <ContextTab item={item} />
        </TabsContent>
      </Tabs>
    </CanvasShell>
  );
}
