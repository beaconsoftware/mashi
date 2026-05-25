"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

/**
 * Client hook for the per-item Enrich agent (POST /api/s2d/{id}/enrich).
 *
 * - useEnrichedContext(itemId)        — read current enriched_context
 * - useRunEnrich(itemId)              — first run or refine call
 *
 * Refine turns pass a `refine` string; first runs omit it. The server
 * persists everything; we keep the client cache fresh by invalidating
 * the read key after every mutation.
 */

export type EnrichSourceKind = "s2d" | "gmail" | "slack" | "linear" | "fireflies";

export interface EnrichPulledSource {
  kind: EnrichSourceKind;
  ref: string;
  label: string;
  snippet: string;
  when: string | null;
  pinned: boolean;
}

export interface EnrichThreadTurn {
  role: "user" | "assistant";
  content: string;
  citations?: number[];
  at: string;
}

export interface EnrichedContext {
  plan: string[];
  pulled_sources: EnrichPulledSource[];
  thread: EnrichThreadTurn[];
  last_enriched_at: string;
}

interface ReadResponse {
  enriched_context: EnrichedContext | null;
  enriched_at: string | null;
}

interface RunResponse {
  enriched_context: EnrichedContext;
}

function enrichKey(itemId: string) {
  return ["s2d-enriched-context", itemId] as const;
}

export function useEnrichedContext(itemId: string | null | undefined) {
  return useQuery({
    queryKey: enrichKey(itemId ?? ""),
    enabled: !!itemId,
    queryFn: async (): Promise<ReadResponse> => {
      const res = await fetch(`/api/s2d/${itemId}/enrich`, { method: "GET" });
      if (!res.ok) throw new Error(`enrich-read ${res.status}`);
      return (await res.json()) as ReadResponse;
    },
    staleTime: 5 * 60_000,
  });
}

export function useRunEnrich(itemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (refine?: string): Promise<EnrichedContext> => {
      const res = await fetch(`/api/s2d/${itemId}/enrich`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(refine ? { refine } : {}),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `enrich ${res.status}`);
      }
      const data = (await res.json()) as RunResponse;
      return data.enriched_context;
    },
    onSuccess: (next) => {
      qc.setQueryData<ReadResponse>(enrichKey(itemId), {
        enriched_context: next,
        enriched_at: next.last_enriched_at,
      });
    },
  });
}
