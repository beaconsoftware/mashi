"use client";

/**
 * ⌘K spotlight: keyword search across S2D, Gmail, Slack, Linear,
 * meetings, calendar — rendered as a centered modal. Keyboard-first:
 * ↑/↓ to move between hits, ↵ to select, Esc to close.
 *
 * Search runs client-side over the same TanStack Query caches the
 * dashboard already uses — no extra network on keystroke.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Mail,
  MessageSquare,
  GitBranch,
  Mic,
  Calendar as CalIcon,
  KanbanSquare,
  ExternalLink,
  X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  useSpotlight,
  SPOTLIGHT_SOURCE_META,
  type SpotlightHit,
  type SpotlightSource,
} from "@/hooks/use-spotlight";
import { useS2DStore } from "@/store/s2d-store";
import { useSpotlightModal } from "@/components/spotlight/spotlight-context";

const SOURCE_ICONS: Record<SpotlightSource, React.ComponentType<{ className?: string }>> = {
  s2d: KanbanSquare,
  gmail: Mail,
  slack: MessageSquare,
  linear: GitBranch,
  fireflies: Mic,
  calendar: CalIcon,
};

export function SpotlightModal() {
  const { open, setOpen } = useSpotlightModal();
  const router = useRouter();
  const setSelectedItem = useS2DStore((s) => s.setSelectedItem);
  const { query, setQuery, debounced, hits, grouped } = useSpotlight();
  const [activeIdx, setActiveIdx] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Reset active hit whenever the result set changes — otherwise the
  // user types and the previously-highlighted row becomes meaningless.
  useEffect(() => {
    setActiveIdx(0);
  }, [debounced]);

  // Re-focus the input every time we open. Also clear stale query so
  // re-opening doesn't show last session's results before the user types.
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      setQuery("");
    }
  }, [open, setQuery]);

  // Flattened list for keyboard nav. Mirrors render order so the
  // visual highlight matches activeIdx 1:1.
  const flat = useMemo(() => grouped.flatMap(([, list]) => list), [grouped]);

  // Scroll the active row into view as the user arrows through results.
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`);
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  function selectHit(h: SpotlightHit) {
    setOpen(false);
    if (h.external && h.href.startsWith("http")) {
      window.open(h.href, "_blank", "noopener,noreferrer");
      return;
    }
    if (h.source === "s2d") {
      // Land on the board and pop the item sheet open via the store.
      router.push("/s2d");
      // setTimeout: let the route mount before the sheet checks
      // selectedItemId, otherwise the sheet renders mid-transition
      // and looks like it teleports in.
      setTimeout(() => setSelectedItem(h.id), 50);
    } else {
      router.push(h.href);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (!flat.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const h = flat[activeIdx];
      if (h) selectHit(h);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-modal flex items-start justify-center bg-background/70 px-4 pt-[12vh] backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-lg border border-border/60 bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        {/* Input row */}
        <div className="flex items-center gap-2 border-b border-border/40 px-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search S2D, Gmail, Slack, Linear, meetings, calendar…"
            className="h-11 border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
          />
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded p-1 text-muted-foreground hover:bg-accent/40 hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Results */}
        <ScrollArea className="max-h-[60vh]">
          <div ref={listRef} className="p-2">
            {!debounced ? (
              <EmptyHint />
            ) : flat.length === 0 ? (
              <div className="px-2 py-8 text-center text-[12px] text-muted-foreground">
                Nothing found for &quot;{query}&quot;.
              </div>
            ) : (
              <SpotlightResults
                grouped={grouped}
                activeIdx={activeIdx}
                onHover={setActiveIdx}
                onSelect={selectHit}
                query={debounced}
              />
            )}
          </div>
        </ScrollArea>

        {/* Footer hint */}
        <div className="flex items-center justify-between border-t border-border/40 px-3 py-1.5 text-[10px] text-muted-foreground/80">
          <span>
            <Kbd>↑</Kbd> <Kbd>↓</Kbd> navigate · <Kbd>↵</Kbd> open · <Kbd>esc</Kbd> close
          </span>
          {debounced && (
            <span>
              {flat.length} result{flat.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyHint() {
  return (
    <div className="space-y-2 px-3 py-6 text-center">
      <div className="text-[12px] font-medium text-foreground/80">Search anything</div>
      <div className="text-[11px] text-muted-foreground">
        Type to look across board items, meetings, messages, Linear issues,
        and calendar events. Runs locally over your cached data.
      </div>
    </div>
  );
}

function SpotlightResults({
  grouped,
  activeIdx,
  onHover,
  onSelect,
  query,
}: {
  grouped: ReadonlyArray<readonly [SpotlightSource, SpotlightHit[]]>;
  activeIdx: number;
  onHover: (idx: number) => void;
  onSelect: (h: SpotlightHit) => void;
  query: string;
}) {
  // Track running index so we can map (group, position) → flat index for
  // matching against activeIdx.
  let runningIdx = 0;
  return (
    <div className="space-y-3">
      {grouped.map(([source, list]) => {
        const meta = SPOTLIGHT_SOURCE_META[source];
        const Icon = SOURCE_ICONS[source];
        return (
          <section key={source}>
            <div className="mb-1 flex items-center gap-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Icon className={cn("h-3 w-3", meta.color)} />
              {meta.label}
              <span className="font-mono opacity-70">{list.length}</span>
            </div>
            <ul>
              {list.map((h) => {
                const idx = runningIdx++;
                const active = idx === activeIdx;
                return (
                  <li key={`${h.source}-${h.id}`}>
                    <button
                      type="button"
                      data-idx={idx}
                      onMouseEnter={() => onHover(idx)}
                      onClick={() => onSelect(h)}
                      className={cn(
                        "flex w-full items-start gap-2 rounded px-2 py-1.5 text-left transition-colors",
                        active
                          ? "bg-accent/40 text-foreground"
                          : "hover:bg-accent/20",
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="line-clamp-1 text-[13px] font-medium text-foreground/90">
                          {highlight(h.title, query)}
                        </div>
                        {h.snippet && (
                          <div className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">
                            {highlight(h.snippet, query)}
                          </div>
                        )}
                        <div className="mt-0.5 font-mono text-[10px] text-muted-foreground/70">
                          {h.meta}
                        </div>
                      </div>
                      {h.external && (
                        <ExternalLink className="mt-1 h-3 w-3 shrink-0 text-muted-foreground" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function highlight(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query);
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-primary/30 text-foreground">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-border/50 bg-background/40 px-1 py-px font-mono text-[9px]">
      {children}
    </kbd>
  );
}
