"use client";

import { useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useS2DItems } from "@/hooks/use-s2d";
import { useSprintStore } from "@/store/sprint-store";
import { Button } from "@/components/ui/button";
import { Sparkles, Check, SkipForward } from "lucide-react";
import { useGSAP } from "@gsap/react";
import { heroEntry, staggerEntry, gsap, EASE } from "@/lib/animation";

/**
 * Shown when activeIndex passes the end of blocks[]. Quick recap +
 * exit. Persisted state lets a reload still land here until the user
 * dismisses.
 */
export function SprintComplete() {
  const router = useRouter();
  const blocks = useSprintStore((s) => s.blocks);
  const sprintStartedAt = useSprintStore((s) => s.sprintStartedAt);
  const exitSprint = useSprintStore((s) => s.exitSprint);
  const { data: items } = useS2DItems();
  const itemMap = useMemo(() => new Map((items ?? []).map((i) => [i.id, i])), [items]);

  const done = blocks.filter((b) => b.status === "done").length;
  const skipped = blocks.filter((b) => b.status === "skipped").length;
  const totalMin = blocks.reduce((s, b) => s + b.durationMin, 0);
  const elapsedMin = sprintStartedAt
    ? Math.round((Date.now() - new Date(sprintStartedAt).getTime()) / 60_000)
    : totalMin;

  const rootRef = useRef<HTMLDivElement | null>(null);
  const sparkleRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLOListElement | null>(null);

  useGSAP(
    () => {
      if (rootRef.current) heroEntry(rootRef.current);
      if (sparkleRef.current) {
        gsap.fromTo(
          sparkleRef.current,
          { rotate: -90, scale: 0 },
          { rotate: 0, scale: 1, duration: 0.6, ease: EASE.elastic, delay: 0.15 }
        );
      }
      if (listRef.current) {
        staggerEntry(listRef.current.children, { delay: 0.3, stagger: 0.06 });
      }
    },
    { scope: rootRef }
  );

  return (
    <div ref={rootRef} className="flex h-full flex-1 items-center justify-center p-8">
      <div className="w-full max-w-md space-y-4 text-center">
        <div ref={sparkleRef} className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/15">
          <Sparkles className="h-5 w-5 text-primary" />
        </div>
        <h1 className="text-xl font-semibold">Sprint complete</h1>
        <p className="text-sm text-muted-foreground">
          {done} done · {skipped} skipped · {elapsedMin}m elapsed
        </p>

        <ol ref={listRef} className="space-y-1.5 text-left">
          {blocks.map((b, i) => {
            const it = itemMap.get(b.s2dItemId);
            if (!it) return null;
            return (
              <li
                key={b.s2dItemId}
                className="flex items-center gap-2 rounded border border-border/40 bg-card p-2 text-[12px]"
              >
                {b.status === "done" ? (
                  <Check className="h-3.5 w-3.5 text-primary" />
                ) : (
                  <SkipForward className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                <span className="font-mono text-[10px] text-muted-foreground w-12">
                  MASH-{it.ticket_number}
                </span>
                <span className="line-clamp-1 flex-1">{it.title}</span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {b.durationMin}m
                </span>
              </li>
            );
          })}
        </ol>

        <div className="flex justify-center gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              exitSprint();
              router.push("/s2d");
            }}
          >
            Back to board
          </Button>
          <Button
            size="sm"
            onClick={() => {
              exitSprint();
              useSprintStore.setState({ phase: "prioritize" });
            }}
          >
            Plan another
          </Button>
        </div>
      </div>
    </div>
  );
}
