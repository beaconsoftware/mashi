"use client";

/**
 * Cockpit "Pending suggestions" surface — the dismissible queue from the
 * Activity Watcher. Hidden when empty.
 *
 * Renders each suggestion with three explicit buttons:
 *   - Yes, move      → POST /api/activity/suggestions/:id/decide { confirm }
 *   - No, keep as is → … { reject }
 *   - Dismiss        → … { dismiss }
 *
 * The reason_human string + a couple of snippet bullets are always shown
 * so the user can trust-or-reject in one glance, per PRD §9.
 */

import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, X, Clock, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Suggestion {
  id: string;
  proposed_state: "in_progress" | "done";
  status: "pending" | "dismissed";
  confidence: number;
  context: {
    reason_human: string;
    signal_snippets: Array<{
      source: string;
      surface: string;
      title?: string;
      app?: string;
      url?: string;
      when: string;
    }>;
  };
  created_at: string;
  s2d_item: {
    id: string;
    title: string;
    status: string;
    priority?: string;
  } | null;
}

const SUGGESTIONS_KEY = ["activity_suggestions"] as const;

export function PendingSuggestions() {
  const qc = useQueryClient();
  const [decidingId, setDecidingId] = useState<string | null>(null);

  const { data, isPending } = useQuery({
    queryKey: SUGGESTIONS_KEY,
    queryFn: async (): Promise<{ pending: Suggestion[]; dismissed: Suggestion[] }> => {
      const res = await fetch("/api/activity/suggestions");
      if (!res.ok) return { pending: [], dismissed: [] };
      return (await res.json()) as { pending: Suggestion[]; dismissed: Suggestion[] };
    },
    refetchInterval: 60_000,
  });

  const decide = useCallback(
    async (id: string, decision: "confirm" | "reject" | "dismiss") => {
      setDecidingId(id);
      try {
        await fetch(`/api/activity/suggestions/${id}/decide`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ decision }),
        });
        await qc.invalidateQueries({ queryKey: SUGGESTIONS_KEY });
        // Item state changed on confirm → invalidate S2D too.
        if (decision === "confirm") {
          await qc.invalidateQueries({ queryKey: ["s2d_items"] });
        }
      } finally {
        setDecidingId(null);
      }
    },
    [qc]
  );

  if (isPending) return null;
  const pending = data?.pending ?? [];
  const dismissed = data?.dismissed ?? [];
  if (pending.length === 0 && dismissed.length === 0) return null;

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Pending suggestions
        </h2>
        {dismissed.length > 0 && (
          <span className="text-[10px] text-muted-foreground">
            {dismissed.length} dismissed · still viewable
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 gap-2">
        {pending.map((s) => (
          <SuggestionCard
            key={s.id}
            suggestion={s}
            disabled={decidingId === s.id}
            onDecide={decide}
            tone="pending"
          />
        ))}
        {dismissed.map((s) => (
          <SuggestionCard
            key={s.id}
            suggestion={s}
            disabled={decidingId === s.id}
            onDecide={decide}
            tone="dismissed"
          />
        ))}
      </div>
    </section>
  );
}

function SuggestionCard({
  suggestion: s,
  disabled,
  onDecide,
  tone,
}: {
  suggestion: Suggestion;
  disabled: boolean;
  onDecide: (id: string, decision: "confirm" | "reject" | "dismiss") => void;
  tone: "pending" | "dismissed";
}) {
  const action =
    s.proposed_state === "done" ? "Move to Done" : "Move to In Progress";
  const itemTitle = s.s2d_item?.title ?? "Item";

  return (
    <div
      className={
        tone === "pending"
          ? "rounded-lg border bg-card/80 p-3"
          : "rounded-lg border border-dashed bg-card/60 p-3 opacity-90"
      }
    >
      <div className="flex items-start gap-2">
        <span
          className={
            s.proposed_state === "done"
              ? "mt-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-primary/80 text-primary-foreground"
              : "mt-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-primary/40 text-primary-foreground"
          }
        >
          <Check className="h-3 w-3" />
        </span>
        <div className="flex-1">
          <div className="text-sm font-medium">
            {action}: <span className="font-semibold">{itemTitle}</span>?
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {s.context.reason_human}
          </div>
          {s.context.signal_snippets?.length > 0 && (
            <ul className="mt-1.5 space-y-0.5 text-[11px] text-muted-foreground">
              {s.context.signal_snippets.slice(0, 2).map((sn, i) => (
                <li key={i} className="flex items-center gap-1.5">
                  <span className="font-medium uppercase tracking-wide text-[9px]">
                    {sn.surface}
                  </span>
                  <span className="truncate">
                    {sn.title ?? sn.url ?? sn.app ?? sn.source}
                  </span>
                  <span className="ml-auto inline-flex items-center gap-1">
                    <Clock className="h-2.5 w-2.5" />
                    {new Date(sn.when).toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        <Button
          size="sm"
          variant="default"
          disabled={disabled}
          onClick={() => onDecide(s.id, "confirm")}
        >
          <Check className="mr-1 h-3 w-3" />
          Yes, {action.toLowerCase()}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled}
          onClick={() => onDecide(s.id, "reject")}
        >
          <X className="mr-1 h-3 w-3" />
          No, keep as is
        </Button>
        {tone === "pending" && (
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() => onDecide(s.id, "dismiss")}
            className="ml-auto"
          >
            Dismiss <ArrowRight className="ml-1 h-3 w-3" />
          </Button>
        )}
      </div>
    </div>
  );
}
