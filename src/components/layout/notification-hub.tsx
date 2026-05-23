"use client";

import { useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Bell } from "lucide-react";
import { useGSAP } from "@gsap/react";
import { useS2DItems, useUpdateS2DItem } from "@/hooks/use-s2d";
import { useS2DStore } from "@/store/s2d-store";
import { PathwayBadge } from "@/components/shared/pathway-badge";
import { SourceIcon } from "@/components/shared/source-icon";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { gsap, withMotion, EASE, DUR } from "@/lib/animation";
import { cn } from "@/lib/utils";

/**
 * Top-bar notification hub. Surfaces every open S2D item that the AI has
 * touched since the user last looked. Clicking an entry routes to the
 * S2D board with that item's detail sheet open.
 *
 * Keeps the source of truth on the row itself (`has_unseen_updates`) — no
 * separate notifications table to drift. The cost is that we re-derive
 * the list client-side from useS2DItems, but that query is already loaded
 * everywhere via the AppShell.
 */
export function NotificationHub() {
  const router = useRouter();
  const pathname = usePathname();
  const setSelected = useS2DStore((s) => s.setSelectedItem);
  const updateItem = useUpdateS2DItem();
  const { data: items } = useS2DItems();
  const [open, setOpen] = useState(false);

  const unseen = (items ?? [])
    .filter((i) => i.has_unseen_updates && i.status !== "done")
    .sort((a, b) => {
      const aT = a.last_update_at ?? a.updated_at;
      const bT = b.last_update_at ?? b.updated_at;
      return bT.localeCompare(aT);
    });

  const count = unseen.length;
  const top10 = unseen.slice(0, 10);

  // Bump-animate the badge whenever count changes (skip the initial mount
  // so the badge doesn't jiggle just because the page loaded with some
  // unseen items already present).
  const badgeRef = useRef<HTMLSpanElement | null>(null);
  const prevCountRef = useRef(count);
  useGSAP(
    () => {
      if (!badgeRef.current) return;
      if (prevCountRef.current === count) return;
      const grew = count > prevCountRef.current;
      prevCountRef.current = count;
      if (!grew) return;
      withMotion(() => {
        gsap.fromTo(
          badgeRef.current,
          { scale: 0.6 },
          { scale: 1, duration: DUR.short, ease: EASE.elastic }
        );
      });
    },
    { dependencies: [count] }
  );

  function openItem(id: string) {
    setOpen(false);
    if (pathname !== "/s2d") {
      router.push("/s2d");
      // setSelectedItem on the next tick so the s2d page is mounted and
      // the sheet has a board to render on top of.
      setTimeout(() => setSelected(id), 50);
    } else {
      setSelected(id);
    }
  }

  function markAllRead() {
    for (const it of unseen) {
      updateItem.mutate({ id: it.id, patch: { has_unseen_updates: false } });
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={count > 0 ? `${count} updates` : "No updates"}
          className="relative inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Bell className="h-4 w-4" />
          {count > 0 && (
            <span
              ref={badgeRef}
              className={cn(
                "absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 font-mono text-[9px] font-semibold text-primary-foreground shadow"
              )}
            >
              {count > 99 ? "99+" : count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-border/40 px-3 py-2">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Updates
          </div>
          {count > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={markAllRead}
              className="h-auto px-1 py-0.5 text-[11px] font-normal text-muted-foreground hover:text-foreground"
            >
              Mark all read
            </Button>
          )}
        </div>
        {count === 0 ? (
          <div className="px-3 py-6 text-center text-[12px] text-muted-foreground">
            Nothing new — you&apos;re all caught up.
          </div>
        ) : (
          <ScrollArea className="max-h-[360px]">
            <ul className="divide-y divide-border/40">
              {top10.map((it) => (
                <li key={it.id}>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => openItem(it.id)}
                    className="block h-auto w-full justify-start whitespace-normal rounded-none px-3 py-2 text-left font-normal hover:bg-accent/40"
                  >
                    <div className="mb-1 flex items-center gap-1.5">
                      {it.source_type && <SourceIcon type={it.source_type} />}
                      <PathwayBadge pathway={it.pathway} />
                      {it.ticket_number != null && (
                        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                          MASH-{it.ticket_number}
                        </span>
                      )}
                    </div>
                    <div className="line-clamp-1 text-[12px] font-medium text-foreground/95">
                      {it.title}
                    </div>
                    {it.last_update_summary && (
                      <div className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
                        {it.last_update_summary}
                      </div>
                    )}
                  </Button>
                </li>
              ))}
            </ul>
            {count > 10 && (
              <div className="border-t border-border/40 px-3 py-1.5 text-center text-[10px] text-muted-foreground">
                +{count - 10} more on the board
              </div>
            )}
          </ScrollArea>
        )}
      </PopoverContent>
    </Popover>
  );
}
