"use client";

import { useRouter } from "next/navigation";
import {
  useSpawnedRail,
  type SpawnedArtifact,
  type SpawnedArtifactKind,
} from "@/store/spawned-rail-store";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Button } from "@/components/ui/button";
import {
  Send,
  Scale,
  GitBranch,
  Eye,
  MessageCircle,
  CalendarPlus,
  Sparkles,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * SpawnedRail (Phase 5 — bottom-of-takeover artifact strip).
 *
 * Surfaces the chain of artifacts produced inside the sprint — sent
 * replies, recorded decisions, spawned follow-up s2d_items, watch
 * check-ins, delegate nudges, staged meetings.
 *
 * Mount inside <FocusOverlay> as the LAST child. Z lives inside the
 * portal's stacking context (z-focus), so a positive z-index here is
 * local to the overlay — z-10 keeps it above the slot grid (which
 * sits at the default z-0) and beneath the detail panel (z-20) so a
 * mid-task drill-down doesn't get clipped by the strip.
 *
 * Empty state: a quiet 36px strip with a "Sprint will collect artifacts
 * here" caption. Populated: 48px scrollable strip of HoverCard chips.
 */
export function SpawnedRail() {
  const artifacts = useSpawnedRail((s) => s.artifacts);
  const isEmpty = artifacts.length === 0;

  return (
    <div
      className={cn(
        "relative z-10 flex shrink-0 items-center border-t border-border/40 bg-background/55 px-3 backdrop-blur-sm transition-[height,padding]",
        isEmpty ? "h-9 py-1.5" : "h-12 py-2"
      )}
    >
      {isEmpty ? (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Sparkles className="h-3 w-3" />
          <span>Sprint will collect artifacts here as you work.</span>
        </div>
      ) : (
        <div className="flex w-full items-center gap-1.5 overflow-x-auto pb-0.5">
          <span className="shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">
            Spawned
          </span>
          {artifacts.map((a) => (
            <ArtifactChip key={a.id} artifact={a} />
          ))}
        </div>
      )}
    </div>
  );
}

function ArtifactChip({ artifact }: { artifact: SpawnedArtifact }) {
  const router = useRouter();
  const tone = toneFor(artifact.kind);
  const hasTarget = artifact.spawnedItemId || artifact.itemId;

  function viewTarget() {
    const targetId = artifact.spawnedItemId ?? artifact.itemId;
    if (!targetId) return;
    router.push(`/s2d?item=${targetId}`);
  }

  return (
    <HoverCard openDelay={0} closeDelay={120}>
      <HoverCardTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn(
            "mashi-magnetic h-auto shrink-0 gap-1 px-2 py-1 text-[11px] font-normal",
            tone
          )}
        >
          <ArtifactIcon kind={artifact.kind} className="h-3 w-3" />
          <span className="max-w-[180px] truncate">{artifact.label}</span>
        </Button>
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-80 space-y-2">
        <div className="flex items-center gap-2">
          <ArtifactIcon kind={artifact.kind} className="h-3.5 w-3.5" />
          <span className="text-[12px] font-semibold">{artifact.label}</span>
          <span className="ml-auto font-mono text-[10px] text-muted-foreground">
            {formatTime(artifact.at)}
          </span>
        </div>
        <p className="text-[12px] leading-snug text-foreground/85">
          {artifact.detail}
        </p>
        {hasTarget && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={viewTarget}
            className="gap-1.5"
          >
            <ExternalLink className="h-3 w-3" />
            View
          </Button>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}

function ArtifactIcon({
  kind,
  className,
}: {
  kind: SpawnedArtifactKind;
  className?: string;
}) {
  switch (kind) {
    case "sent":
      return <Send className={className} />;
    case "decision":
      return <Scale className={className} />;
    case "follow-up":
      return <GitBranch className={className} />;
    case "check-in":
      return <Eye className={className} />;
    case "nudge":
      return <MessageCircle className={className} />;
    case "staged-meeting":
      return <CalendarPlus className={className} />;
  }
}

function toneFor(kind: SpawnedArtifactKind): string {
  // Sanctioned scale only (/15 /40 /55 /60 /80 /95).
  switch (kind) {
    case "sent":
      return "border-emerald-500/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/15";
    case "decision":
      return "border-primary/40 bg-primary/15 text-primary hover:bg-primary/15";
    case "follow-up":
      return "border-amber-500/40 bg-amber-500/15 text-amber-200 hover:bg-amber-500/15";
    case "check-in":
      return "border-sky-500/40 bg-sky-500/15 text-sky-200 hover:bg-sky-500/15";
    case "nudge":
      return "border-fuchsia-500/40 bg-fuchsia-500/15 text-fuchsia-200 hover:bg-fuchsia-500/15";
    case "staged-meeting":
      return "border-violet-500/40 bg-violet-500/15 text-violet-200 hover:bg-violet-500/15";
  }
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}
