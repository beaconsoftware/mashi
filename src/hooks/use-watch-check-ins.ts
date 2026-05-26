"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { EnrichSourceKind } from "@/hooks/use-enriched-context";

/**
 * Client hook for the per-item check-in trail (GET /api/s2d/{id}/check-in)
 * and write (POST /api/s2d/{id}/check-in).
 *
 * - useWatchCheckIns(itemId)     — read signals-since-last + history
 * - useRecordCheckIn(itemId)     — write a new check-in row, returns
 *                                  the row + signals snapshot
 *
 * Writes invalidate the read key so the activity strip and history
 * collapse to a fresh "since now" baseline immediately.
 */

export interface ActivitySignal {
  kind: EnrichSourceKind;
  ref: string;
  label: string;
  at: string;
  snippet?: string;
}

export interface CheckInRow {
  id: string;
  at: string;
  note: string | null;
  continued: boolean;
}

export interface CheckInRead {
  sinceISO: string;
  lastCheckInAt: string | null;
  signals: ActivitySignal[];
  history: CheckInRow[];
}

function readKey(itemId: string) {
  return ["watch-check-ins", itemId] as const;
}

export function useWatchCheckIns(itemId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: readKey(itemId ?? ""),
    enabled: !!itemId && enabled,
    queryFn: async (): Promise<CheckInRead> => {
      const res = await fetch(`/api/s2d/${itemId}/check-in`, { method: "GET" });
      if (!res.ok) throw new Error(`check-in-read ${res.status}`);
      return (await res.json()) as CheckInRead;
    },
    staleTime: 60_000,
  });
}

export function useRecordCheckIn(itemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      continue: boolean;
      note?: string;
    }): Promise<{ checkIn: CheckInRow; signals: ActivitySignal[] }> => {
      const res = await fetch(`/api/s2d/${itemId}/check-in`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `check-in ${res.status}`);
      }
      const data = (await res.json()) as {
        checkIn: CheckInRow;
        signals: ActivitySignal[];
      };
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: readKey(itemId) });
    },
  });
}
