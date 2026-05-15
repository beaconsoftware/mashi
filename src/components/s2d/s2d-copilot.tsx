"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles, RotateCw, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUpdateS2DItem } from "@/hooks/use-s2d";
import { useUserProfileStore } from "@/store/user-profile-store";
import { streamPostText } from "@/lib/streaming";
import { PATHWAY_META, type S2DItem } from "@/types";
import { cn } from "@/lib/utils";

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Streams a pathway-specific suggestion from claude-opus-4-7 via
 * /api/s2d/[id]/suggest. Caches the result on the item in the Zustand
 * store so reopening the Sheet within the TTL skips a fresh call.
 *
 * Phase 2 will replace the Zustand persistence with Supabase row updates
 * (s2d_items.ai_suggestion + ai_suggestion_generated_at).
 */
export function S2DCopilot({ item }: { item: S2DItem }) {
  const updateItem = useUpdateS2DItem();
  const styleProfile = useUserProfileStore((s) => s.styleProfile);

  const cached = isFresh(item) ? item.ai_suggestion ?? "" : "";
  const [text, setText] = useState<string>(cached);
  const [status, setStatus] = useState<"idle" | "streaming" | "done" | "error">(
    cached ? "done" : "idle"
  );
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const meta = PATHWAY_META[item.pathway];

  // Kick off a stream when the sheet opens on a new item without fresh cache.
  useEffect(() => {
    if (status === "done" || status === "streaming") return;
    void run();
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  async function run() {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setText("");
    setError(null);
    setStatus("streaming");

    let accumulated = "";
    try {
      const full = await streamPostText(
        `/api/s2d/${item.id}/suggest`,
        { item, styleProfile },
        (delta) => {
          accumulated += delta;
          setText(accumulated);
        },
        ctrl.signal
      );
      setStatus("done");
      updateItem.mutate({
        id: item.id,
        patch: {
          ai_suggestion: full,
          ai_suggestion_generated_at: new Date().toISOString(),
        },
      });
    } catch (err) {
      if (ctrl.signal.aborted) return;
      const msg = err instanceof Error ? err.message : "stream failed";
      setError(msg);
      setStatus("error");
    }
  }

  return (
    <div className="overflow-hidden rounded-md border border-border/50 bg-card">
      <div className="flex items-center justify-between border-b border-border/40 bg-secondary/40 px-3 py-2">
        <div className="flex items-center gap-2">
          <Sparkles
            className={cn(
              "h-3.5 w-3.5 text-primary",
              status === "streaming" && "animate-pulse"
            )}
          />
          <span className="text-[11px] font-semibold uppercase tracking-wider">Mashi co-pilot</span>
          <span className="font-mono text-[10px] text-muted-foreground">
            {meta.shortLabel.toLowerCase()} · opus-4-7
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1 text-[10px]"
          onClick={run}
          disabled={status === "streaming"}
        >
          <RotateCw className={cn("h-3 w-3", status === "streaming" && "animate-spin")} />
          {status === "streaming" ? "Streaming…" : "Regenerate"}
        </Button>
      </div>

      <div className="p-3">
        {status === "error" ? (
          <div className="flex items-start gap-2 rounded border border-destructive/30 bg-destructive/10 p-2 text-[12px] text-destructive">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div>
              <div className="font-medium">Couldn't reach Claude.</div>
              <div className="text-muted-foreground">{error}</div>
            </div>
          </div>
        ) : text.length === 0 && status !== "streaming" ? (
          <div className="text-[12px] text-muted-foreground">No suggestion yet.</div>
        ) : (
          <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/90">
            {text}
            {status === "streaming" && (
              <span className="ml-0.5 inline-block h-3 w-1.5 translate-y-0.5 bg-primary/80 animate-pulse" />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function isFresh(item: S2DItem): boolean {
  if (!item.ai_suggestion || !item.ai_suggestion_generated_at) return false;
  const age = Date.now() - new Date(item.ai_suggestion_generated_at).getTime();
  return age < CACHE_TTL_MS;
}
