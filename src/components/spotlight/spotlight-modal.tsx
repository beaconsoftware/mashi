"use client";

// translucency-audit-ok: file — <mark> uses bg-primary/30 for search-term
// highlight (sanctioned scale doesn't include a "light tint over text"
// step). Surface chrome itself goes through shadcn primitives, which
// are doctrine-compliant.

/**
 * ⌘K spotlight: keyword search across S2D, Gmail, Slack, Linear,
 * meetings, calendar — rendered as a centered command palette.
 * Keyboard-first: ↑/↓ to move between hits, ↵ to select, Esc to close.
 *
 * Built on shadcn <Dialog> + <Command> (cmdk + Radix Dialog). Radix
 * Dialog gives us Esc / click-outside / focus-trap; cmdk's <Command>
 * gives us keyboard nav + scroll-into-view of the active item.
 *
 * We pass `shouldFilter={false}` to cmdk because search is done by
 * `useSpotlight` against the TanStack Query caches we already have —
 * cmdk's built-in filter would drop items whose `value` doesn't
 * include the search string, but our snippet matches can come from
 * the description, not the title.
 *
 * Search runs client-side over the same TanStack Query caches the
 * dashboard already uses — no extra network on keystroke.
 */
import { Fragment, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Mail,
  MessageSquare,
  GitBranch,
  Mic,
  Calendar as CalIcon,
  KanbanSquare,
  ExternalLink,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
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

  // Clear stale query when the dialog closes so reopening doesn't show
  // last session's results before the user types.
  useEffect(() => {
    if (!open) setQuery("");
  }, [open, setQuery]);

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

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        showCloseButton={false}
        className="top-[12vh] translate-y-0 max-w-2xl gap-0 overflow-hidden p-0"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Spotlight search</DialogTitle>
          <DialogDescription>
            Search across S2D, Gmail, Slack, Linear, meetings, and calendar.
          </DialogDescription>
        </DialogHeader>
        <Command shouldFilter={false} className="bg-card">
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Search S2D, Gmail, Slack, Linear, meetings, calendar..."
          />
          <CommandList className="max-h-[60vh]">
            {!debounced ? (
              <CommandEmpty>
                <EmptyHint />
              </CommandEmpty>
            ) : hits.length === 0 ? (
              <CommandEmpty>
                <span className="text-muted-foreground">
                  Nothing found for &quot;{query}&quot;.
                </span>
              </CommandEmpty>
            ) : (
              grouped.map(([source, list], groupIdx) => {
                const meta = SPOTLIGHT_SOURCE_META[source];
                const Icon = SOURCE_ICONS[source];
                // Fragment (not <div>) so cmdk's keyboard nav can
                // traverse CommandItems across groups without the
                // wrapper breaking the descendant search.
                return (
                  <Fragment key={source}>
                    {groupIdx > 0 && <CommandSeparator />}
                    <CommandGroup
                      heading={
                        <span className="flex items-center gap-2">
                          <Icon className={cn("h-3 w-3", meta.color)} />
                          <span>{meta.label}</span>
                          <span className="font-mono opacity-70">{list.length}</span>
                        </span>
                      }
                    >
                      {list.map((h) => (
                        <CommandItem
                          key={`${h.source}-${h.id}`}
                          // Unique value per item so cmdk's selection
                          // (highlighted row) can track which one is
                          // active. With shouldFilter=false the value
                          // is just an id — never matched against the
                          // query.
                          value={`${h.source}-${h.id}`}
                          onSelect={() => selectHit(h)}
                          className="items-start"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="line-clamp-1 text-[13px] font-medium text-foreground/90">
                              {highlight(h.title, debounced)}
                            </div>
                            {h.snippet && (
                              <div className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">
                                {highlight(h.snippet, debounced)}
                              </div>
                            )}
                            <div className="mt-0.5 font-mono text-[10px] text-muted-foreground/70">
                              {h.meta}
                            </div>
                          </div>
                          {h.external && (
                            <ExternalLink className="mt-1 h-3 w-3 shrink-0 text-muted-foreground" />
                          )}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </Fragment>
                );
              })
            )}
          </CommandList>
          <div className="flex items-center justify-between border-t border-border/40 px-3 py-1.5 text-[10px] text-muted-foreground/80">
            <span>
              <Kbd>↑</Kbd> <Kbd>↓</Kbd> navigate · <Kbd>↵</Kbd> open · <Kbd>esc</Kbd> close
            </span>
            {debounced && (
              <span>
                {hits.length} result{hits.length === 1 ? "" : "s"}
              </span>
            )}
          </div>
        </Command>
      </DialogContent>
    </Dialog>
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
