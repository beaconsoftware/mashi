"use client";

import { useMemo } from "react";
import { Bug, RotateCcw } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/agent/copy-button";
import { messagesToReplay } from "@/lib/agent/replay";

/**
 * J3 — replay / debug a turn.
 *
 * An internal-only disclosure that shows the exact message list a turn was
 * reconstructed from (`messagesToReplay`, the same pure function the loop runs
 * before every model call) and offers a re-run (the D2 regenerate path). This
 * is the inspect-and-re-run surface the brief asks for; it makes debugging a
 * corrupted replay (A1) or a bad output tractable without DB spelunking.
 *
 * Gated behind `NEXT_PUBLIC_AGENT_DEBUG=1` so it never shows for normal users.
 * It reads only the thread data already loaded client-side (the user's own,
 * RLS-scoped messages), so there is no new endpoint and no cross-user surface.
 * The system prompt is intentionally not shown: the loop rebuilds it fresh per
 * turn, so it isn't part of a turn's persisted, replayable state.
 */
export function ReplayDebugPanel({
  messages,
  onRerun,
  canRerun,
}: {
  messages: Array<{
    role: string;
    content: string | null;
    tool_calls: unknown;
    tool_results: unknown;
    attachments?: unknown;
    pinned_references?: unknown;
  }>;
  /** D2 re-run of the last turn. */
  onRerun: () => void;
  canRerun: boolean;
}) {
  const enabled = process.env.NEXT_PUBLIC_AGENT_DEBUG === "1";

  const replayJson = useMemo(() => {
    if (!enabled) return "";
    try {
      return JSON.stringify(messagesToReplay(messages), null, 2);
    } catch (err) {
      return `// replay reconstruction failed: ${
        err instanceof Error ? err.message : String(err)
      }`;
    }
  }, [enabled, messages]);

  if (!enabled || messages.length === 0) return null;

  return (
    <Collapsible className="group/replay rounded-md border border-dashed border-border/50 bg-card/55">
      <CollapsibleTrigger className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground">
        <Bug className="size-3 shrink-0" />
        Replay / debug
        <span className="ml-auto font-mono text-[10px] text-muted-foreground/70">
          {messages.length} rows
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 px-2.5 pb-2">
        <p className="text-[10px] text-muted-foreground">
          Reconstructed Anthropic message list (the system prompt is rebuilt
          fresh per turn and is not part of replay state).
        </p>
        <div className="relative">
          <div className="absolute right-1 top-1 z-10">
            <CopyButton text={replayJson} label="Copy replay context" />
          </div>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/60 px-2 py-1.5 pr-8 font-mono text-[10px] text-foreground/80">
            {replayJson}
          </pre>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onRerun}
          disabled={!canRerun}
          className="mashi-press h-6 gap-1 px-2 text-[11px]"
        >
          <RotateCcw className="size-3" />
          Re-run last turn
        </Button>
      </CollapsibleContent>
    </Collapsible>
  );
}
