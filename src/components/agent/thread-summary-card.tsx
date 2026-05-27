"use client";

import { useMemo, useState } from "react";
import { ChevronRight, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Collapsed view of an agent thread's rolling summary (Phase 6).
 *
 * Rendered at the top of the ThreadView when `agent_threads.summary`
 * is non-null. Closed by default; expanding reveals the digest so the
 * user can read what the agent retained without scrolling through
 * superseded turns. Header hints at the thread's age when a
 * `threadCreatedAt` is provided ("3 weeks of conversation, expand").
 *
 * Composes shadcn Button only — no hand-rolled primitives — and uses
 * the sanctioned bg-primary/15 translucency step per AGENTS.md.
 */
export function ThreadSummaryCard({
  summary,
  threadCreatedAt,
  defaultOpen = false,
}: {
  summary: string;
  threadCreatedAt?: string | null;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const ageLabel = useMemo(
    () => describeAge(threadCreatedAt),
    [threadCreatedAt]
  );

  return (
    <div className="rounded-md border border-primary/30 bg-primary/15 px-2.5 py-1.5 text-[11px]">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        className="mashi-press h-auto w-full justify-start gap-1 rounded p-0 text-[10px] font-mono uppercase tracking-wider text-primary hover:bg-transparent hover:text-primary"
        aria-expanded={open}
      >
        <ChevronRight
          className={cn(
            "h-3 w-3 transition-transform",
            open && "rotate-90"
          )}
        />
        <History className="h-3 w-3" />
        <span>
          {ageLabel ? `${ageLabel} of conversation, expand` : "Prior conversation summary"}
        </span>
      </Button>
      {open && (
        <p className="mt-1.5 whitespace-pre-wrap text-foreground/85">
          {summary}
        </p>
      )}
    </div>
  );
}

/**
 * Bucket the elapsed time into the coarse label used in the chip.
 * Returns null when the timestamp is missing or unparseable so the
 * card falls back to the generic "Prior conversation summary" label.
 */
function describeAge(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const ms = Math.max(0, Date.now() - t);
  const days = ms / 86_400_000;
  if (days < 1) return "Today";
  if (days < 2) return "1 day";
  if (days < 7) return `${Math.round(days)} days`;
  const weeks = days / 7;
  if (weeks < 2) return "1 week";
  if (weeks < 8) return `${Math.round(weeks)} weeks`;
  const months = days / 30;
  if (months < 2) return "1 month";
  if (months < 12) return `${Math.round(months)} months`;
  const years = days / 365;
  if (years < 2) return "1 year";
  return `${Math.round(years)} years`;
}
