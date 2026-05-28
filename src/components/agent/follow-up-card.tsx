"use client";

import { useState } from "react";
import { HelpCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface PendingFollowUp {
  /** Anthropic tool_use_id for the ask_followup_question call. The
   * client POSTs to `${base}/follow-up/${id}` with the chosen option. */
  id: string;
  question: string;
  options?: string[];
}

interface Props {
  followUp: PendingFollowUp;
  /** True when the parent is already streaming (the option-click stream
   * itself, or any other in-flight turn). Disables the buttons. */
  busy: boolean;
  /** Called when the user picks an option. The parent owns the actual
   * fetch + SSE-read because it shares state (live deltas, streaming
   * flag, query invalidation) with the rest of the thread. */
  onPick: (followUpId: string, option: string) => void;
}

/**
 * Inline follow-up card for ask_followup_question agent tool calls.
 *
 * Renders the model's clarification question plus optional option
 * chips. Clicking an option hands the choice back to the parent
 * <ThreadView>, which streams the next turn through the
 * /follow-up/[callId] route. The user can also free-text in the
 * composer; that lands as the next user turn and dismisses the card
 * naturally because the persisted-state derivation requires an
 * unanswered question (no user message after the call).
 *
 * Doctrine notes:
 *   - shadcn Card + Button only (no hand-rolled chrome).
 *   - Sanctioned translucency: primary/15 tint + primary/40 border —
 *     softer than the amber-tinted ApprovalCard since a follow-up isn't
 *     a gate, just a prompt for the user.
 *   - No GSAP, no motion utilities. The card is conversational chrome.
 */
export function FollowUpCard({ followUp, busy, onPick }: Props) {
  const [picked, setPicked] = useState<string | null>(null);

  function clickOption(option: string) {
    if (busy || picked) return;
    setPicked(option);
    onPick(followUp.id, option);
  }

  if (picked) {
    return (
      <Card className="border-border/40 bg-card/80 py-2">
        <CardContent className="px-3 py-0 text-[11px] text-muted-foreground">
          <span className="font-mono text-[10px] uppercase tracking-wider">
            picked:
          </span>{" "}
          <span className="text-foreground/85">{picked}</span>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn("border-primary/40 bg-primary/15 py-2")}>
      <CardHeader className="px-3 pb-1">
        <CardTitle className="flex items-start gap-1.5 text-xs font-medium leading-snug text-foreground/90">
          <HelpCircle className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
          <span className="whitespace-pre-wrap">{followUp.question}</span>
        </CardTitle>
      </CardHeader>
      {followUp.options && followUp.options.length > 0 && (
        <CardContent className="flex flex-wrap gap-1.5 px-3 py-0">
          {followUp.options.map((opt) => (
            <Button
              key={opt}
              type="button"
              size="sm"
              variant="outline"
              onClick={() => clickOption(opt)}
              disabled={busy}
              className="mashi-press h-7 gap-1 px-2 text-[11px]"
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              {opt}
            </Button>
          ))}
        </CardContent>
      )}
    </Card>
  );
}
