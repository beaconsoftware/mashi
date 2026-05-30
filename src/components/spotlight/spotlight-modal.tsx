"use client";

// translucency-audit-ok: file — <mark> uses bg-primary/30 for search-term
// highlight (sanctioned scale doesn't include a "light tint over text"
// step). Surface chrome itself goes through shadcn primitives, which
// are doctrine-compliant.

/**
 * Search panel for the Spotlight agent dialog (Phase 4).
 *
 * Originally a standalone ⌘+K Dialog component; Phase 4 moves the
 * top-level surface to `<SpotlightAgent>` which mounts this panel
 * inside its Search tab. The panel itself owns no open/close state;
 * it just renders the cmdk command palette and fires `onPicked` so
 * the parent can dismiss the agent dialog.
 *
 * Built on cmdk's <Command> — keyboard nav (↑/↓), scroll-into-view,
 * and ↵-to-select are free. We pass `shouldFilter={false}` because
 * search is done by `useSpotlight` against the TanStack Query caches
 * we already have — cmdk's built-in filter would drop items whose
 * `value` doesn't include the search string.
 */
import { Fragment } from "react";
import { useRouter } from "next/navigation";
import {
  Mail,
  MessageSquare,
  MessageSquareText,
  GitBranch,
  Mic,
  Calendar as CalIcon,
  KanbanSquare,
  ExternalLink,
} from "lucide-react";
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

const SOURCE_ICONS: Record<SpotlightSource, React.ComponentType<{ className?: string }>> = {
  s2d: KanbanSquare,
  gmail: Mail,
  slack: MessageSquare,
  linear: GitBranch,
  fireflies: Mic,
  calendar: CalIcon,
  conversations: MessageSquareText,
};

export function SpotlightSearchPanel({
  onPicked,
  onConversation,
}: {
  onPicked: () => void;
  /** D4: open a matched agent thread. The parent decides whether to open
   * the item-bound sheet (bound thread) or resume the orphan chat
   * (Spotlight thread), so the generic href router is bypassed. */
  onConversation?: (hit: SpotlightHit) => void;
}) {
  const router = useRouter();
  const setSelectedItem = useS2DStore((s) => s.setSelectedItem);
  const { query, setQuery, debounced, hits, grouped } = useSpotlight();

  function selectHit(h: SpotlightHit) {
    if (h.source === "conversations") {
      // Parent owns dialog state for this path (it may switch tabs rather
      // than close), so don't call onPicked here.
      onConversation?.(h);
      return;
    }
    onPicked();
    if (h.external && h.href.startsWith("http")) {
      window.open(h.href, "_blank", "noopener,noreferrer");
      return;
    }
    if (h.source === "s2d") {
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
    <Command shouldFilter={false} className="bg-card">
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="Search S2D, Gmail, Slack, Linear, meetings, calendar..."
      />
      <CommandList className="max-h-[55vh]">
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
