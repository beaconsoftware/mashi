"use client";

import { useQuery } from "@tanstack/react-query";
import type { ItemBrief } from "@/lib/s2d/item-brief";

/**
 * Fetch the consolidated ItemBrief for an S2D item.
 *
 * Cached aggressively (staleTime: Infinity) because the brief is the
 * SUBSTRATE that every action agent reads from during a sprint, and
 * re-synthesizing on every slot activation would burn tokens for no gain.
 * The cache is in-memory only, so it naturally invalidates when the sprint
 * page unmounts.
 *
 * Pass `enabled: false` to defer the fetch (e.g. before a slot is active).
 * The hook will return `{ data: undefined, isLoading: false }` and won't
 * hit the server until enabled flips to true.
 */
export function useItemBrief(itemId: string | null, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["item-brief", itemId],
    queryFn: async (): Promise<ItemBrief> => {
      const r = await fetch(`/api/s2d/${itemId}/brief`);
      if (!r.ok) {
        const body = await r.text().catch(() => "");
        throw new Error(body || `${r.status} ${r.statusText}`);
      }
      return (await r.json()) as ItemBrief;
    },
    enabled: !!itemId && (opts?.enabled ?? true),
    // Brief is expensive to produce and rarely changes during a sprint.
    // We let it sit in cache for the sprint's duration; the TanStack cache
    // tears down with the page so cross-sprint we'll re-synthesize.
    staleTime: Infinity,
    gcTime: 60 * 60 * 1000,
    retry: 1,
  });
}
