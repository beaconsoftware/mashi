"use client";

import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ResolveCandidate } from "@/lib/agent/resolve";

/**
 * Render candidates from `resolve_reference` as a clickable card list.
 * Used in two places:
 *   - Inline inside the Spotlight chat timeline when the agent surfaces
 *     multiple candidates and waits for the user to pick.
 *   - The agent's system prompt also instructs it to render confidence
 *     scores in plain text; this surface is the click-to-bind affordance.
 *
 * Picking a candidate calls `onPick(itemId)`. The Spotlight wrapper
 * sends the agent a follow-up turn naming the picked item; the agent
 * then calls attach_thread_to_item.
 */
export function CandidateList({
  candidates,
  onPick,
  className,
}: {
  candidates: ResolveCandidate[];
  onPick: (itemId: string) => void;
  className?: string;
}) {
  if (candidates.length === 0) return null;
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        Candidates
      </div>
      {candidates.map((c) => (
        <CandidateRow key={c.id} candidate={c} onPick={onPick} />
      ))}
    </div>
  );
}

function CandidateRow({
  candidate,
  onPick,
}: {
  candidate: ResolveCandidate;
  onPick: (itemId: string) => void;
}) {
  const confidencePct = Math.round(candidate.confidence * 100);
  const ticketLabel =
    candidate.ticket_number != null ? `MASH-${candidate.ticket_number}` : "item";
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => onPick(candidate.id)}
      className="mashi-magnetic h-auto w-full flex-col items-start gap-0.5 rounded-md border-border/40 bg-card/80 px-2.5 py-1.5 text-left"
      title={`Pick ${ticketLabel} ${candidate.title}`}
    >
      <div className="flex w-full items-center gap-1.5 text-[11px] font-medium">
        <Sparkles className="h-3 w-3 shrink-0 text-primary" />
        <span className="truncate text-foreground/90">{candidate.title}</span>
        <span className="ml-auto shrink-0 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {confidencePct}%
        </span>
      </div>
      <div className="flex w-full items-center gap-1.5 text-[10px] text-muted-foreground">
        <span className="font-mono">{ticketLabel}</span>
        <span>·</span>
        <span>{candidate.status}</span>
        {candidate.pathway && (
          <>
            <span>·</span>
            <span>{candidate.pathway}</span>
          </>
        )}
        <span className="ml-auto truncate text-[10px] italic text-muted-foreground/70">
          {candidate.match_reason}
        </span>
      </div>
    </Button>
  );
}
