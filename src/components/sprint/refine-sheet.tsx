"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Send, Wand2 } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useRefineSheet } from "@/store/refine-sheet-store";
import { MergedSourceList } from "@/components/sprint/sprint-card-workspace";
import { useS2DItems } from "@/hooks/use-s2d";
import {
  useEnrichedContext,
  useRunEnrich,
  type EnrichThreadTurn,
} from "@/hooks/use-enriched-context";

/**
 * Global slide-up sheet that hosts the Refine textarea, the recent
 * refine turns, and the merged source list (pinned > pulled > cached).
 * One instance lives in `<SprintActiveModeMulti>`; canvases summon it
 * via `useRefineSheet.openFor(itemId)`. Keyboard `/` and `⌥+R` bind to
 * the focused slot in the multi-active mode root.
 */
export function RefineSheet() {
  const open = useRefineSheet((s) => s.open);
  const itemId = useRefineSheet((s) => s.boundItemId);
  const close = useRefineSheet((s) => s.close);
  const { data: items } = useS2DItems();
  const item = useMemo(
    () => (itemId ? items?.find((i) => i.id === itemId) : null),
    [itemId, items]
  );

  return (
    <Sheet open={open} onOpenChange={(v) => (v ? null : close())}>
      <SheetContent
        side="bottom"
        className="z-modal max-h-[70vh] bg-card/95 backdrop-blur-sm"
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 text-sm">
            <Wand2 className="h-4 w-4 text-primary" />
            Refine
            {item && (
              <span className="ml-1 truncate text-xs font-normal text-muted-foreground">
                · {item.title}
              </span>
            )}
          </SheetTitle>
          <SheetDescription>
            Chat with the agent — ask for examples, narrow the source set, or
            pull more context. Pinned sources persist across refines.
          </SheetDescription>
        </SheetHeader>

        {item ? (
          <div className="grid max-h-[calc(70vh-110px)] gap-4 overflow-hidden p-5 pt-2 md:grid-cols-[1fr_280px]">
            <RefineConversation itemId={item.id} />
            <aside className="relative hidden min-h-0 flex-col overflow-hidden rounded-md border border-border/40 bg-card/55 p-2 md:flex">
              <div className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                Sources
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                <MergedSourceList item={item} enabled variant="side-strip" />
              </div>
            </aside>
          </div>
        ) : (
          <div className="p-5 pt-2 text-[12px] text-muted-foreground">
            No item bound — open this from a sprint slot.
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function RefineConversation({ itemId }: { itemId: string }) {
  const { data } = useEnrichedContext(itemId);
  const ctx = data?.enriched_context ?? null;
  const run = useRunEnrich(itemId);
  const busy = run.isPending;
  const [draft, setDraft] = useState("");
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const refineTurns: EnrichThreadTurn[] = (ctx?.thread ?? []).slice(2);

  useEffect(() => {
    composerRef.current?.focus();
  }, [itemId]);

  async function send() {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    try {
      await run.mutateAsync(text);
    } catch {
      setDraft(text);
    }
  }

  return (
    <section className="flex min-h-0 flex-col gap-2">
      {refineTurns.length > 0 ? (
        <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
          {refineTurns.map((turn, i) => (
            <li
              key={`${turn.at}:${i}`}
              className={
                turn.role === "user"
                  ? "rounded-md border border-border/30 bg-secondary/40 px-2.5 py-1.5 text-[11px] leading-snug text-foreground/90"
                  : "rounded-md border border-primary/30 bg-primary/15 px-2.5 py-1.5 text-[11px] leading-snug text-muted-foreground"
              }
            >
              <div className="mb-0.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">
                {turn.role === "user" ? "you" : "mashi"}
              </div>
              {turn.content}
            </li>
          ))}
        </ul>
      ) : (
        <p className="flex-1 rounded-md border border-dashed border-border/40 bg-card/55 p-3 text-[11px] text-muted-foreground">
          Ask Mashi to pull more context, narrow the source set, or change the
          plan. The conversation persists per item.
        </p>
      )}
      <div className="flex items-start gap-1.5">
        <Textarea
          ref={composerRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={2}
          placeholder="Refine — narrow to May, focus on Linear, pull in the budget thread…"
          className="min-h-0 resize-none rounded-md border-border/40 bg-card/80 px-2.5 py-1.5 text-[12px] leading-snug placeholder:text-muted-foreground/60"
          disabled={busy}
        />
        <Button
          type="button"
          size="sm"
          onClick={send}
          disabled={busy || draft.trim().length === 0}
          className="mashi-press h-8 gap-1 px-2"
          title="Enter to send · Shift+Enter for newline"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
        </Button>
      </div>
    </section>
  );
}
