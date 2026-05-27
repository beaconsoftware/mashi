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
  /**
   * Phase 6: rolling summary of the persistent agent thread for this
   * item, snapshotted on sprint pre-warm. Null when no thread or no
   * summary yet. The canvas reads `thread_summary?.text` to render a
   * one-line "Last conversation: …" under the title.
   */
  thread_summary?: { text: string; at: string } | null;
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

/**
 * Server stores enriched_context with DEFAULT '{}'::jsonb, so rows that
 * have never been enriched return an empty object. Normalise to the
 * full shape with empty arrays so every consumer can safely read
 * `.plan.length`, `.pulled_sources.length`, `.thread.length` without
 * defensive checks at every call site.
 *
 * Returns null when ctx is null AND there's no timestamp — that's the
 * "really nothing yet" state. Returns a normalised object whenever the
 * server gave us anything (so the card can show "enriched Nm ago" if
 * the timestamp is set even when the fields are missing — paranoid but
 * cheap).
 */
function normalize(raw: unknown): EnrichedContext | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<EnrichedContext>;
  const plan = Array.isArray(r.plan) ? r.plan : [];
  const pulled_sources = Array.isArray(r.pulled_sources) ? r.pulled_sources : [];
  const thread = Array.isArray(r.thread) ? r.thread : [];
  const last_enriched_at = typeof r.last_enriched_at === "string" ? r.last_enriched_at : "";
  const ts = r.thread_summary;
  const thread_summary =
    ts && typeof ts === "object" && typeof (ts as { text?: unknown }).text === "string"
      ? { text: (ts as { text: string }).text, at: (ts as { at?: string }).at ?? "" }
      : null;
  // Empty defaults across the board → no enrich has happened. Signal
  // null so callers' `hasRun` derivation stays simple. A populated
  // thread_summary is enough to keep the row.
  if (
    plan.length === 0 &&
    pulled_sources.length === 0 &&
    thread.length === 0 &&
    !last_enriched_at &&
    !thread_summary
  ) {
    return null;
  }
  return { plan, pulled_sources, thread, last_enriched_at, thread_summary };
}

export function useEnrichedContext(
  itemId: string | null | undefined,
  opts?: { polling?: boolean }
) {
  return useQuery({
    queryKey: enrichKey(itemId ?? ""),
    enabled: !!itemId,
    queryFn: async (): Promise<ReadResponse> => {
      const res = await fetch(`/api/s2d/${itemId}/enrich`, { method: "GET" });
      if (!res.ok) throw new Error(`enrich-read ${res.status}`);
      const data = (await res.json()) as ReadResponse;
      return {
        enriched_context: normalize(data.enriched_context),
        enriched_at: data.enriched_at,
      };
    },
    staleTime: 5 * 60_000,
    // Phase 4: while the sprint pre-warm scheduler is mid-flight on this
    // item, the server-written enriched_context fields land outside the
    // mutation cache. Caller passes polling=true to refetch every 2s so
    // the canvas paints the pre-warmed content as soon as it's there.
    refetchInterval: opts?.polling ? 2_000 : false,
    refetchIntervalInBackground: false,
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
      // Normalise here too — defensive in case the server hands back
      // a partial object after future schema changes.
      return normalize(data.enriched_context) ?? data.enriched_context;
    },
    onSuccess: (next) => {
      qc.setQueryData<ReadResponse>(enrichKey(itemId), {
        enriched_context: normalize(next),
        enriched_at: next.last_enriched_at,
      });
    },
  });
}

/**
 * Toggle the pinned flag on a single pulled source. Pinned sources
 * survive subsequent refine turns; unpinned ones get replaced when the
 * agent surfaces a new hit set.
 *
 * Optimistic: the local cache flips immediately so the pin star
 * doesn't lag the click. On error we roll back to the prior snapshot.
 */
export function usePinSource(itemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      source: { kind: EnrichSourceKind; ref: string };
      pinned: boolean;
    }): Promise<EnrichedContext> => {
      const res = await fetch(`/api/s2d/${itemId}/enrich`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `pin ${res.status}`);
      }
      const data = (await res.json()) as RunResponse;
      return normalize(data.enriched_context) ?? data.enriched_context;
    },
    onMutate: async (args) => {
      await qc.cancelQueries({ queryKey: enrichKey(itemId) });
      const prev = qc.getQueryData<ReadResponse>(enrichKey(itemId));
      if (prev?.enriched_context) {
        const nextSources = prev.enriched_context.pulled_sources.map((s) =>
          s.kind === args.source.kind && s.ref === args.source.ref
            ? { ...s, pinned: args.pinned }
            : s
        );
        qc.setQueryData<ReadResponse>(enrichKey(itemId), {
          ...prev,
          enriched_context: { ...prev.enriched_context, pulled_sources: nextSources },
        });
      }
      return { prev };
    },
    onError: (_err, _args, ctx) => {
      if (ctx?.prev) qc.setQueryData(enrichKey(itemId), ctx.prev);
    },
    onSuccess: (next) => {
      qc.setQueryData<ReadResponse>(enrichKey(itemId), {
        enriched_context: normalize(next),
        enriched_at: next.last_enriched_at,
      });
    },
  });
}
