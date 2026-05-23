"use client";

/**
 * Discoverable search affordance in the top bar. Clicking it opens
 * the ⌘K spotlight. Without this button users wouldn't know the
 * shortcut exists — the keybinding alone is invisible.
 */
import { Search } from "lucide-react";
import { useSpotlightModal } from "@/components/spotlight/spotlight-context";
import { Button } from "@/components/ui/button";

export function SpotlightTrigger() {
  const { setOpen } = useSpotlightModal();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => setOpen(true)}
      className="group flex h-7 items-center gap-2 rounded-md border border-border/40 bg-background/40 px-2 text-[11px] font-normal text-muted-foreground transition-colors hover:border-border hover:text-foreground"
      title="Search (⌘K)"
    >
      <Search className="h-3 w-3" />
      <span className="hidden sm:inline">Search</span>
      <kbd className="hidden rounded border border-border/40 bg-background/60 px-1 py-px font-mono text-[9px] sm:inline">
        ⌘K
      </kbd>
    </Button>
  );
}
