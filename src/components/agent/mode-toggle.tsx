"use client";

import { useState } from "react";
import { Eye, Wand2 } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  type AgentMode,
  useAgentThread,
  threadKey,
} from "@/store/agent-thread-store";

/**
 * Plan/Act mode toggle that lives in the chat header.
 *
 * Quality Phase 3. Plan mode = read + ask only. Act mode = full ring
 * access. Authoritative state is agent_threads.mode in the DB; this
 * component flips it optimistically and PATCHes the matching route
 * (item-id-keyed or by-id-keyed depending on which surface owns the
 * thread). On error we roll back and surface a subtle inline hint.
 *
 * Tiny by design — Tabs from shadcn, variant="line" for the same line
 * underline used in SpotlightAgent.
 */
export function ModeToggle({
  itemId,
  threadId,
  initialMode,
}: {
  itemId?: string;
  threadId?: string;
  /** Mode read from the persisted thread row on load. Used to seed the
   * store the first time the toggle renders for this thread. */
  initialMode: AgentMode;
}) {
  const key = threadKey({ itemId, threadId });
  const stored = useAgentThread((s) => s.modeByThread[key]);
  const setMode = useAgentThread((s) => s.setMode);
  const mode: AgentMode = stored ?? initialMode;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function flip(next: AgentMode) {
    if (next === mode || pending) return;
    setError(null);
    setPending(true);
    const prev = mode;
    setMode(key, next);
    const base = itemId
      ? `/api/agent/threads/${itemId}/mode`
      : `/api/agent/threads/by-id/${threadId}/mode`;
    try {
      const res = await fetch(base, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: next }),
      });
      if (!res.ok) {
        setMode(key, prev);
        setError("Couldn't switch mode.");
      }
    } catch {
      setMode(key, prev);
      setError("Couldn't switch mode.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Tabs
        value={mode}
        onValueChange={(v) => flip(v as AgentMode)}
        className="gap-0"
      >
        <TabsList variant="line" className="h-7 gap-1">
          <TabsTrigger
            value="plan"
            disabled={pending}
            className="px-2 text-[11px] font-medium"
            aria-label="Plan mode"
            title="Plan mode — Mashi reads and asks only"
          >
            <Eye className="h-3 w-3" />
            Plan
          </TabsTrigger>
          <TabsTrigger
            value="act"
            disabled={pending}
            className="px-2 text-[11px] font-medium"
            aria-label="Act mode"
            title="Act mode — Mashi can write and send"
          >
            <Wand2 className="h-3 w-3" />
            Act
          </TabsTrigger>
        </TabsList>
      </Tabs>
      {error && (
        <span className="text-[10px] text-destructive">{error}</span>
      )}
    </div>
  );
}
