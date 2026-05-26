"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Loader2,
  Sparkles,
  ArrowUp,
  ArrowDown,
  Plus,
  X,
  Copy,
  CalendarPlus,
  Calendar,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { CanvasShell, type CanvasBaseProps } from "./_shared/canvas-shell";
import { useEnrichedContext } from "@/hooks/use-enriched-context";
import { useSpawnedRail } from "@/store/spawned-rail-store";

/**
 * MeetingPrepCanvas — serves meeting_backed.
 *
 * Layout:
 *   • Top:    candidate meeting picker (sorted by attendee+title match)
 *   • Middle: editable talking-points bullets with reorder + regenerate
 *   • Bottom: Copy to clipboard · Add to meeting agenda (terminal exit)
 *
 * Pre-warm fills enriched_context.talking_points (bullets + anchored
 * meetingId). The candidate list always re-fetches on slot entry so a
 * meeting added since the last warm is included.
 *
 * Done fires `onExit({ kind: "stage-meeting", calendarEventId, talkingPoints })`.
 * The parent dispatches /api/s2d/[id]/stage-meeting, which marks the
 * item done and stores the staged_meeting on enriched_context.
 */

interface CandidateMeeting {
  id: string;
  external_id: string | null;
  title: string;
  start_at: string;
  end_at: string;
  attendees: Array<{ name?: string | null; email?: string }>;
  location: string | null;
  meeting_url: string | null;
  score: number;
}

interface StoredTalkingPoints {
  bullets?: string[];
  meetingId?: string | null;
}

interface CandidatesResp {
  meetings: CandidateMeeting[];
}

const MAX_BULLETS = 8;

export function MeetingPrepCanvas({
  item,
  active,
  prewarm,
  onExit,
  onOpenDetail,
}: CanvasBaseProps) {
  const enrich = useEnrichedContext(item.id, { polling: prewarm.status === "warming" });
  const stored = readTalkingPoints(enrich.data?.enriched_context);
  const [candidates, setCandidates] = useState<CandidateMeeting[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [candidatesErr, setCandidatesErr] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string>(
    stored?.meetingId ?? ""
  );
  const [bullets, setBullets] = useState<string[]>(() =>
    (stored?.bullets ?? []).slice(0, MAX_BULLETS)
  );
  const [regenerating, setRegenerating] = useState(false);
  const [staging, setStaging] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pushArtifact = useSpawnedRail((s) => s.push);

  // Hydrate when the slot promotes a different item.
  useEffect(() => {
    const next = readTalkingPoints(enrich.data?.enriched_context);
    setBullets((next?.bullets ?? []).slice(0, MAX_BULLETS));
    setSelectedId(next?.meetingId ?? "");
    setError(null);
    setCopied(false);
  }, [item.id, enrich.data?.enriched_context]);

  // Fetch candidates on activation.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setLoadingCandidates(true);
    setCandidatesErr(null);
    fetch(`/api/sprint/meeting-candidates?itemId=${item.id}`)
      .then(async (res) => {
        if (!res.ok) {
          const t = await res.text().catch(() => "");
          throw new Error(t || `candidates ${res.status}`);
        }
        return (await res.json()) as CandidatesResp;
      })
      .then((data) => {
        if (cancelled) return;
        const list = data.meetings ?? [];
        setCandidates(list);
        // If the stored anchor isn't in the list, fall back to top match.
        setSelectedId((prev) => {
          if (prev && list.some((m) => candidateMatchesId(m, prev))) {
            return prev;
          }
          const top = list[0];
          return top ? top.external_id ?? top.id : "";
        });
      })
      .catch((e) => {
        if (!cancelled) setCandidatesErr(e instanceof Error ? e.message : "failed");
      })
      .finally(() => {
        if (!cancelled) setLoadingCandidates(false);
      });
    return () => {
      cancelled = true;
    };
  }, [item.id, active]);

  const selectedMeeting = useMemo(
    () => candidates.find((m) => candidateMatchesId(m, selectedId)) ?? null,
    [candidates, selectedId]
  );

  const hasBullets = bullets.length > 0;
  const talkingPointsText = useMemo(
    () =>
      bullets
        .map((b) => b.trim())
        .filter((b) => b.length > 0)
        .map((b) => `• ${b}`)
        .join("\n"),
    [bullets]
  );

  function updateBullet(i: number, text: string) {
    setBullets((bs) => bs.map((b, idx) => (idx === i ? text : b)));
  }
  function addBullet() {
    setBullets((bs) =>
      bs.length >= MAX_BULLETS ? bs : [...bs, ""]
    );
  }
  function removeBullet(i: number) {
    setBullets((bs) => bs.filter((_, idx) => idx !== i));
  }
  function moveBullet(i: number, dir: -1 | 1) {
    setBullets((bs) => {
      const j = i + dir;
      if (j < 0 || j >= bs.length) return bs;
      const next = bs.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  async function regenerate() {
    if (regenerating) return;
    setRegenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/sprint/prewarm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: item.id,
          pathway: "meeting_backed",
          reason: "repathway",
        }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(t || `regenerate ${res.status}`);
      }
      await enrich.refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : "regenerate failed");
    } finally {
      setRegenerating(false);
    }
  }

  async function copyToClipboard() {
    if (!talkingPointsText) return;
    try {
      const header = selectedMeeting?.title
        ? `Talking points for ${selectedMeeting.title}\n\n`
        : "Talking points\n\n";
      await navigator.clipboard.writeText(header + talkingPointsText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Couldn't write to clipboard");
    }
  }

  async function stage() {
    if (staging) return;
    if (!selectedMeeting) {
      setError("Pick a meeting before staging.");
      return;
    }
    setStaging(true);
    setError(null);
    try {
      // Copy too — most calendar UIs don't accept programmatic writes
      // through our Google API scope. The user pastes into the agenda.
      if (talkingPointsText) {
        try {
          await navigator.clipboard.writeText(talkingPointsText);
        } catch {
          // non-fatal — staging still proceeds
        }
      }
      const calendarEventId =
        selectedMeeting.external_id ?? selectedMeeting.id;
      pushArtifact({
        kind: "staged-meeting",
        itemId: item.id,
        label: `Staged for ${selectedMeeting.title}`,
        detail: formatMeetingWhen(selectedMeeting.start_at),
      });
      await onExit({
        kind: "stage-meeting",
        calendarEventId,
        talkingPoints: talkingPointsText,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "stage failed");
    } finally {
      setStaging(false);
    }
  }

  return (
    <CanvasShell
      item={item}
      active={active}
      prewarm={prewarm}
      onExit={onExit}
      onOpenDetail={onOpenDetail}
      footerVariant="compact"
      primary={
        <Button
          type="button"
          size="sm"
          onClick={stage}
          disabled={staging || !selectedMeeting || !hasBullets}
          className="mashi-press h-7 gap-1.5 px-3 text-[11px]"
          title="Stage these talking points for the selected meeting"
        >
          {staging ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <CalendarPlus className="h-3 w-3" />
          )}
          {staging ? "Staging" : "Add to meeting agenda"}
        </Button>
      }
    >
      <div className="space-y-3">
        <section className="rounded-md border border-border/40 bg-card/60 p-2.5">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Meeting
            </span>
            {loadingCandidates && (
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
            )}
          </div>
          {candidatesErr ? (
            <div className="rounded border border-destructive/40 bg-destructive/15 px-2 py-1.5 text-[11px] text-destructive">
              {candidatesErr}
            </div>
          ) : candidates.length === 0 && !loadingCandidates ? (
            <p className="rounded border border-dashed border-border/40 bg-card/55 p-3 text-[11px] text-muted-foreground">
              No upcoming meetings matched. Schedule one in your calendar, then
              return here — or pick another pathway.
            </p>
          ) : (
            <>
              <Select value={selectedId} onValueChange={setSelectedId}>
                <SelectTrigger className="h-8 text-[11px]">
                  <SelectValue placeholder="Pick a meeting" />
                </SelectTrigger>
                <SelectContent className="z-dropdown">
                  {candidates.map((m) => {
                    const id = m.external_id ?? m.id;
                    return (
                      <SelectItem key={id} value={id} className="text-[11px]">
                        <span className="font-medium">{m.title}</span>
                        <span className="ml-1 text-muted-foreground">
                          · {formatMeetingWhen(m.start_at)}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              {selectedMeeting && (
                <div className="mt-1.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                  <Calendar className="h-3 w-3 shrink-0" />
                  <span className="truncate">
                    {formatAttendeeSummary(selectedMeeting.attendees)}
                  </span>
                  {selectedMeeting.meeting_url && (
                    <a
                      href={selectedMeeting.meeting_url}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-auto inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground"
                    >
                      Join
                      <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  )}
                </div>
              )}
            </>
          )}
        </section>

        <section className="rounded-md border border-border/40 bg-card/60 p-2.5">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Talking points
              {hasBullets && (
                <span className="ml-1 normal-case tracking-normal text-muted-foreground/70">
                  · {bullets.filter((b) => b.trim().length > 0).length}
                </span>
              )}
            </span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={regenerate}
              disabled={regenerating}
              className="mashi-press h-6 gap-1 px-2 text-[11px]"
              title="Regenerate the bullet list from scratch"
            >
              {regenerating ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="h-3 w-3" />
              )}
              {regenerating
                ? "Drafting"
                : hasBullets
                  ? "Regenerate"
                  : "Draft"}
            </Button>
          </div>
          {!hasBullets && !regenerating && (
            <p className="rounded border border-dashed border-border/40 bg-card/55 p-3 text-[11px] text-muted-foreground">
              {prewarm.status === "warming"
                ? "Drafting talking points — they'll land in a moment."
                : "Draft talking points anchored to the chosen meeting. You can reorder, edit, or add bullets after."}
            </p>
          )}
          {hasBullets && (
            <ol className="space-y-1.5">
              {bullets.map((b, i) => (
                <li
                  key={i}
                  className={cn(
                    "group/bullet flex items-start gap-1.5 rounded border border-border/30 bg-card/60 p-1.5"
                  )}
                >
                  <span className="mt-1 font-mono text-[10px] text-primary">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <Textarea
                    value={b}
                    onChange={(e) => updateBullet(i, e.target.value)}
                    rows={1}
                    className="min-h-0 flex-1 resize-none rounded border-border/40 bg-card/80 px-2 py-1 text-[11px] leading-snug"
                  />
                  <div className="flex shrink-0 flex-col gap-0.5">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() => moveBullet(i, -1)}
                      disabled={i === 0}
                      className="mashi-press h-5 w-5"
                      title="Move up"
                      aria-label="Move bullet up"
                    >
                      <ArrowUp className="h-3 w-3" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() => moveBullet(i, 1)}
                      disabled={i === bullets.length - 1}
                      className="mashi-press h-5 w-5"
                      title="Move down"
                      aria-label="Move bullet down"
                    >
                      <ArrowDown className="h-3 w-3" />
                    </Button>
                  </div>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => removeBullet(i)}
                    className="mashi-press h-5 w-5 text-muted-foreground/60"
                    title="Remove bullet"
                    aria-label="Remove bullet"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </li>
              ))}
            </ol>
          )}
          <div className="mt-1.5 flex items-center justify-between">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={addBullet}
              disabled={bullets.length >= MAX_BULLETS}
              className="mashi-press h-6 gap-1 px-2 text-[11px] text-muted-foreground"
            >
              <Plus className="h-3 w-3" />
              Add bullet
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={copyToClipboard}
              disabled={!hasBullets}
              className="mashi-press h-6 gap-1 px-2 text-[11px]"
              title="Copy the bullets to the clipboard"
            >
              <Copy className="h-3 w-3" />
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </section>

        {error && <div className="text-[11px] text-destructive">{error}</div>}
      </div>
    </CanvasShell>
  );
}

function readTalkingPoints(ctx: unknown): StoredTalkingPoints | null {
  if (!ctx || typeof ctx !== "object") return null;
  const candidate = (ctx as { talking_points?: StoredTalkingPoints })
    .talking_points;
  if (!candidate) return null;
  const bullets = Array.isArray(candidate.bullets)
    ? candidate.bullets.filter(
        (b): b is string => typeof b === "string" && b.trim().length > 0
      )
    : [];
  const meetingId =
    typeof candidate.meetingId === "string" ? candidate.meetingId : null;
  if (bullets.length === 0 && !meetingId) return null;
  return { bullets, meetingId };
}

function candidateMatchesId(m: CandidateMeeting, id: string): boolean {
  return m.external_id === id || m.id === id;
}

function formatMeetingWhen(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const opts: Intl.DateTimeFormatOptions = sameDay
    ? { hour: "numeric", minute: "2-digit" }
    : { weekday: "short", hour: "numeric", minute: "2-digit" };
  return d.toLocaleString(undefined, opts);
}

function formatAttendeeSummary(
  attendees: Array<{ name?: string | null; email?: string }>
): string {
  if (attendees.length === 0) return "No attendees listed";
  const names = attendees
    .slice(0, 3)
    .map((a) => a.name?.trim() || a.email?.split("@")[0] || "")
    .filter((s) => s.length > 0);
  if (names.length === 0) return `${attendees.length} attendees`;
  const more = attendees.length - names.length;
  return more > 0 ? `${names.join(", ")} +${more} more` : names.join(", ");
}
