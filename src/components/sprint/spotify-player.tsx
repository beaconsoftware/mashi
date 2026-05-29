"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  ChevronUp,
  ChevronDown,
  Volume2,
  Music,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useSpotifyState, useSpotifyControl, type SpotifyTrack } from "@/hooks/use-spotify";

/**
 * Sticky bottom-anchored Spotify player for sprint active mode.
 *
 * Two heights:
 * - Collapsed: a compact bar with album thumb, title, artist, transport
 *   controls, volume.
 * - Expanded: same bar + the upcoming queue rolls up above it like
 *   Spotify's own bottom drawer.
 *
 * Failure modes the UI handles:
 * - Not connected, render an inline link to /settings/connections.
 * - Connected but no active device, "Open Spotify on a device to start".
 * - Premium-required (free account), surfaces a one-time hint.
 *
 * Polling is gated by `enabled` (caller passes `phase === "active"`).
 */
export function SpotifyPlayer({ enabled }: { enabled: boolean }) {
  const { data, isLoading } = useSpotifyState({ enabled });
  const control = useSpotifyControl();
  const [expanded, setExpanded] = useState(false);
  const [premiumWarn, setPremiumWarn] = useState<string | null>(null);
  const lastReasonRef = useRef<string | null>(null);

  useEffect(() => {
    if (!premiumWarn) return;
    const id = setTimeout(() => setPremiumWarn(null), 6000);
    return () => clearTimeout(id);
  }, [premiumWarn]);

  if (!enabled) return null;
  if (isLoading && !data) return null;

  // Not connected to Spotify.
  if (data && !data.connected) {
    return (
      <div className="pointer-events-auto flex items-center gap-2 rounded-lg border border-border/40 bg-card/80 px-3 py-2 text-[12px] text-muted-foreground backdrop-blur-md">
        <Music className="h-3.5 w-3.5" />
        Connect Spotify in
        <a
          href="/settings/connections"
          className="font-semibold text-foreground underline-offset-2 hover:underline"
        >
          Settings
        </a>
        for music + ambient art.
      </div>
    );
  }

  // Connected but no active device. We have a last-played track to
  // render as a "Resume" card. Resume = transfer playback to the first
  // available device and replay the previous context (last playlist).
  if (data && data.connected && !data.active) {
    const lastTrack = data.last_played ?? null;
    const lastCtx = data.last_context ?? null;
    return (
      <div className="pointer-events-auto flex items-center gap-2 rounded-lg border border-border/40 bg-card/80 px-2 py-1.5 backdrop-blur-md">
        <div className="relative h-8 w-8 shrink-0 overflow-hidden rounded">
          {lastTrack?.album_image_url ? (
            <Image
              src={lastTrack.album_image_url}
              alt=""
              fill
              sizes="32px"
              className="object-cover opacity-70"
              unoptimized
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-secondary">
              <Music className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-medium leading-tight text-muted-foreground">
            {lastTrack ? `Last played, ${lastTrack.name}` : "Open Spotify to start"}
          </div>
          <div className="truncate text-[10px] leading-tight text-muted-foreground/80">
            {lastTrack?.artist_name ?? "No active device"}
          </div>
        </div>
        <Button
          size="sm"
          variant="default"
          onClick={async () => {
            try {
              await control.mutateAsync({
                action: "resume",
                context_uri: lastCtx?.uri,
              });
            } catch (err) {
              const e = err as Error & { reason?: string | null; status?: number };
              if (e.reason === "PREMIUM_REQUIRED") {
                setPremiumWarn("Spotify Premium is required for transport controls.");
              } else if (e.status === 404) {
                setPremiumWarn("Open Spotify on a device first, then try again.");
              }
            }
          }}
          className="h-7 gap-1 px-2.5 text-[11px]"
        >
          <Play className="h-3 w-3 fill-current" />
          Resume
        </Button>
        {premiumWarn && (
          <span className="hidden text-[10px] text-amber-300 md:inline">{premiumWarn}</span>
        )}
      </div>
    );
  }

  const track = data?.track ?? null;
  const queue = data?.queue ?? [];
  const playing = !!data?.playing;
  const volume = data?.device?.volume_percent ?? 0;

  async function transport(action: "play" | "pause" | "next" | "prev") {
    try {
      await control.mutateAsync({ action });
    } catch (err) {
      const e = err as Error & { reason?: string | null };
      if (e.reason === "PREMIUM_REQUIRED" && lastReasonRef.current !== "PREMIUM_REQUIRED") {
        setPremiumWarn("Spotify Premium is required for transport controls.");
        lastReasonRef.current = "PREMIUM_REQUIRED";
      }
    }
  }

  async function changeVolume(next: number) {
    try {
      await control.mutateAsync({ action: "volume", volume_percent: next });
    } catch {
      // Premium-only; warning already surfaced.
    }
  }

  // The queue dropdown lives inside the TopBar, which is a `<ChromeBar>`
  // with backdrop-blur + an explicit z-chrome. Any non-portaled child
  // with z-dropdown gets trapped at z-chrome globally (its z=50 only
  // resolves WITHIN the z=40 stacking context) and loses painting
  // fights to siblings of the TopBar that have their own stacking
  // contexts (every backdrop-blur kanban column on /s2d).
  //
  // Radix Popover portals its content into the body, escaping the
  // TopBar's stacking context entirely. The anchor + trigger split
  // lets us keep the dropdown's visual width matched to the player
  // bar while the click target stays on just the chevron.
  const queueOpen = expanded && queue.length > 0;

  return (
    <Popover open={queueOpen} onOpenChange={setExpanded}>
    <PopoverAnchor asChild>
    <div className="pointer-events-auto relative w-full">
      {/* Compact player bar — sized to fit inside the 48px page TopBar
          without crowding it. py-1 + h-7 thumb + h-6 buttons keeps a
          comfortable 4px margin top/bottom inside the TopBar row. */}
      <div
        className={cn(
          "flex items-center gap-2 rounded-lg border border-border/40 bg-card/80 px-2 py-1 backdrop-blur-md"
        )}
      >
        {/* Art */}
        <div className="relative h-7 w-7 shrink-0 overflow-hidden rounded">
          {track?.album_image_url ? (
            <Image
              src={track.album_image_url}
              alt=""
              fill
              sizes="28px"
              className="object-cover"
              unoptimized
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-secondary">
              <Music className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
          )}
        </div>

        {/* Title + artist */}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-medium leading-tight">
            {track?.name ?? "Nothing playing"}
          </div>
          <div className="truncate text-[10px] leading-tight text-muted-foreground">
            {track?.artist_name ?? data?.device?.name ?? ""}
          </div>
        </div>

        {/* Transport */}
        <div className="flex items-center gap-0.5">
          <Button
            size="icon"
            variant="ghost"
            onClick={() => transport("prev")}
            className="mashi-icon-glow h-6 w-6"
            aria-label="Previous track"
          >
            <SkipBack className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => transport(playing ? "pause" : "play")}
            className="mashi-icon-glow h-6 w-6"
            aria-label={playing ? "Pause" : "Play"}
          >
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => transport("next")}
            className="mashi-icon-glow h-6 w-6"
            aria-label="Next track"
          >
            <SkipForward className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Volume */}
        <div className="hidden items-center gap-1 md:flex">
          <Volume2 className="h-3 w-3 text-muted-foreground" />
          <Slider
            min={0}
            max={100}
            value={[volume]}
            onValueChange={(v) => changeVolume(v[0] ?? 0)}
            className="w-20 cursor-pointer"
            aria-label="Volume"
          />
        </div>

        {/* Expand queue — PopoverTrigger only wraps the chevron so the
            click target is just this button, not the whole player bar.
            The anchor element (containing the player bar) is what
            Radix uses to position + width-match the popover content. */}
        <PopoverTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className="mashi-icon-glow h-6 w-6"
            aria-label={queueOpen ? "Hide queue" : "Show queue"}
          >
            {queueOpen ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronUp className="h-3.5 w-3.5" />
            )}
          </Button>
        </PopoverTrigger>
      </div>

      {premiumWarn && (
        <div className="mt-1 flex items-center gap-1.5 rounded-md bg-amber-500/10 px-2 py-1 text-[11px] text-amber-300">
          <AlertCircle className="h-3 w-3" />
          {premiumWarn}
        </div>
      )}
    </div>
    </PopoverAnchor>
    {/* Queue dropdown content — portaled out of the TopBar's stacking
        context. Width tracks the anchor (player bar) via Radix's
        `--radix-popper-anchor-width` CSS var so the drawer feels like
        an extension of the player. max-h-72 keeps it from running
        off-screen; the inner ol scrolls. */}
    <PopoverContent
      side="bottom"
      align="start"
      sideOffset={6}
      className="rounded-lg border border-border/40 bg-card/95 p-2 shadow-2xl backdrop-blur-md"
      style={{ width: "var(--radix-popper-anchor-width)" }}
    >
      <div className="mb-1 px-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Up next ({queue.length})
      </div>
      <ol className="max-h-72 space-y-0.5 overflow-y-auto">
        {queue.map((t, i) => (
          <QueueRow key={`${t.id}-${i}`} t={t} />
        ))}
      </ol>
    </PopoverContent>
    </Popover>
  );
}

function QueueRow({ t }: { t: SpotifyTrack }) {
  return (
    <li className="flex items-center gap-2 rounded px-1.5 py-1 text-[11px]">
      <div className="relative h-6 w-6 shrink-0 overflow-hidden rounded">
        {t.album_image_url ? (
          <Image
            src={t.album_image_url}
            alt=""
            fill
            sizes="24px"
            className="object-cover"
            unoptimized
          />
        ) : (
          <div className="h-full w-full bg-secondary" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium leading-tight">{t.name}</div>
        <div className="truncate text-[10px] leading-tight text-muted-foreground">
          {t.artist_name}
        </div>
      </div>
    </li>
  );
}
