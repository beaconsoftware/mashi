"use client";

import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAgentThread } from "@/store/agent-thread-store";
import { cn } from "@/lib/utils";

/**
 * Opens the persistent agent thread sheet bound to a given item.
 *
 * Variants:
 *   - default → primary-ish chip, used in the detail sheet header.
 *   - ghost   → low-key icon button for card hover state on the board.
 */
export function AskMashiButton({
  itemId,
  variant = "default",
  className,
  label,
}: {
  itemId: string;
  variant?: "default" | "ghost";
  className?: string;
  label?: string;
}) {
  const openFor = useAgentThread((s) => s.openFor);
  if (variant === "ghost") {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={(e) => {
          e.stopPropagation();
          openFor(itemId);
        }}
        className={cn(
          "mashi-icon-glow h-6 w-6 text-muted-foreground hover:text-primary",
          className
        )}
        aria-label="Ask Mashi about this item"
        title="Ask Mashi"
      >
        <Sparkles className="mashi-icon-hover h-3 w-3" />
      </Button>
    );
  }
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={(e) => {
        e.stopPropagation();
        openFor(itemId);
      }}
      className={cn("mashi-press h-7 gap-1.5 px-2 text-[11px]", className)}
      title="Open the persistent agent thread for this item"
    >
      <Sparkles className="h-3 w-3 text-primary" />
      {label ?? "Ask Mashi"}
    </Button>
  );
}
