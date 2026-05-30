"use client";

import { Hash, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AgentReference } from "@/lib/agent/references";

/**
 * B2 (P3) — pinned @-mention reference chip.
 *
 * Shown above the composer (removable) while drafting, and above a user
 * message (read-only) in the thread view. Visually distinct from attachment
 * chips: a primary-tinted pill with a # glyph + MASH-N + title.
 */

function ticketLabel(ref: AgentReference): string {
  return typeof ref.ticketNumber === "number"
    ? `MASH-${ref.ticketNumber}`
    : "item";
}

export function ReferenceChip({
  reference,
  onRemove,
}: {
  reference: AgentReference;
  onRemove?: () => void;
}) {
  return (
    <div
      className={`flex max-w-[220px] items-center gap-1.5 rounded border border-primary/30 bg-primary/15 px-2 py-1 text-xs ${
        onRemove ? "mashi-press" : ""
      }`}
    >
      <Hash className="h-3 w-3 shrink-0 text-primary" />
      <span className="shrink-0 font-mono text-[10px] text-primary">
        {ticketLabel(reference)}
      </span>
      <span className="min-w-0 flex-1 truncate text-foreground/90">
        {reference.label}
      </span>
      {onRemove && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onRemove}
          className="h-4 w-4 shrink-0 text-muted-foreground/70 hover:text-foreground"
          title="Remove reference"
          aria-label={`Remove ${ticketLabel(reference)} ${reference.label}`}
        >
          <X className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}

/** A wrapped row of reference chips. */
export function ReferenceChipList({
  references,
  onRemove,
  className,
}: {
  references: AgentReference[];
  onRemove?: (id: string) => void;
  className?: string;
}) {
  if (references.length === 0) return null;
  return (
    <div className={`flex flex-wrap gap-1.5 ${className ?? ""}`}>
      {references.map((r) => (
        <ReferenceChip
          key={r.id}
          reference={r}
          onRemove={onRemove ? () => onRemove(r.id) : undefined}
        />
      ))}
    </div>
  );
}
