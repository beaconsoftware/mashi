"use client";

import {
  CalendarIcon,
  GitPullRequestIcon,
  MailIcon,
  SquareKanbanIcon,
  UsersIcon,
} from "lucide-react";
import {
  Source,
  Sources,
  SourcesContent,
  SourcesTrigger,
} from "@/components/ai-elements/sources";
import type { SourceDescriptor, SourceKind } from "@/lib/agent/provenance";

// C1: provenance chips under an assistant answer. Aggregated from the read
// tools the turn used (see thread-view's sourcesByMessageId). Sources that
// carry a URL link out (new tab); the rest render as a labelled, non-link
// chip so the user still sees what the answer was grounded in.

const KIND_ICON: Record<SourceKind, typeof MailIcon> = {
  item: SquareKanbanIcon,
  message: MailIcon,
  meeting: UsersIcon,
  linear: GitPullRequestIcon,
  calendar: CalendarIcon,
};

export function MessageSources({
  sources,
}: {
  sources: SourceDescriptor[];
}) {
  if (sources.length === 0) return null;

  return (
    <Sources>
      <SourcesTrigger count={sources.length} />
      <SourcesContent>
        {sources.map((s, i) => {
          const Icon = KIND_ICON[s.kind];
          if (s.href) {
            return (
              <Source key={`${s.kind}-${i}`} href={s.href}>
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="block font-medium">{s.title}</span>
              </Source>
            );
          }
          return (
            <span
              key={`${s.kind}-${i}`}
              className="flex items-center gap-2 text-muted-foreground"
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="block font-medium">{s.title}</span>
            </span>
          );
        })}
      </SourcesContent>
    </Sources>
  );
}
