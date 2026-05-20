"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Company, S2DItem, S2DStatus } from "@/types";
import type { ContextResp } from "@/lib/s2d/claude-prompt";

const S2D_KEY = ["s2d_items"] as const;
const COMPANIES_KEY = ["companies"] as const;
const S2D_CONTEXT_KEY = (id: string) => ["s2d_context", id] as const;

/**
 * Fetch + cache the full source-aware context bundle for one S2D item.
 * Backed by /api/s2d/[id]/context. Used by sprint-active-mode to surface
 * source previews per slot without the user opening the side panel.
 *
 * staleTime 60s — context is heavy enough that we don't want to refetch
 * every render, but fresh enough to be useful if a new sync just landed.
 * Keep the query enabled-gated so we only fetch when a consumer mounts
 * (e.g. the slot is active or the bench card is hover-expanded).
 */
export function useS2DItemContext(id: string | null, enabled: boolean) {
  return useQuery({
    queryKey: S2D_CONTEXT_KEY(id ?? "__noop"),
    queryFn: async (): Promise<ContextResp> => {
      if (!id) throw new Error("missing id");
      const res = await fetch(`/api/s2d/${id}/context`);
      if (!res.ok) throw new Error(`context fetch failed: ${res.status}`);
      return res.json();
    },
    enabled: enabled && !!id,
    staleTime: 60_000,
  });
}

interface S2DRow {
  id: string;
  title: string;
  description: string | null;
  status: S2DStatus;
  pathway: S2DItem["pathway"];
  priority: S2DItem["priority"];
  est_minutes: number | null;
  energy: S2DItem["energy"];
  source_type: S2DItem["source_type"] | null;
  source_id: string | null;
  source_url: string | null;
  source_label: string | null;
  company_id: string | null;
  ai_suggestion: string | null;
  ai_suggestion_generated_at: string | null;
  ai_draft: string | null;
  sprint_date: string | null;
  sprint_order: number | null;
  sprint_type: S2DItem["sprint_type"] | null;
  queue_reason: string | null;
  queue_until: string | null;
  delegated_to: string | null;
  outcome: string | null;
  linked_sources: S2DItem["linked_sources"];
  created_at: string;
  updated_at: string;
  done_at: string | null;
}

/** All companies, keyed by id for fast joins. */
export function useCompanies() {
  return useQuery({
    queryKey: COMPANIES_KEY,
    queryFn: async (): Promise<Company[]> => {
      const sb = createSupabaseBrowserClient();
      const { data, error } = await sb
        .from("companies")
        .select("id, name, color_hex, status")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 60_000,
  });
}

/** All S2D items, joined with their company. */
export function useS2DItems() {
  const companiesQuery = useCompanies();
  const companyMap = new Map((companiesQuery.data ?? []).map((c) => [c.id, c]));

  return useQuery({
    queryKey: S2D_KEY,
    queryFn: async (): Promise<S2DItem[]> => {
      const sb = createSupabaseBrowserClient();
      const { data, error } = await sb
        .from("s2d_items")
        .select("*")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return ((data ?? []) as S2DRow[]).map((r) => ({
        ...r,
        company: r.company_id ? companyMap.get(r.company_id) ?? null : null,
      })) as S2DItem[];
    },
    enabled: companiesQuery.isSuccess,
    staleTime: 5_000,
  });
}

export function useUpdateS2DItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<S2DItem> }) => {
      // Route through /api/s2d/:id so the server can also push status changes
      // back to Linear (and any future bidirectional integrations).
      const res = await fetch(`/api/s2d/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      }
    },
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: S2D_KEY });
      const prev = qc.getQueryData<S2DItem[]>(S2D_KEY);
      qc.setQueryData<S2DItem[]>(S2D_KEY, (items) =>
        items?.map((it) =>
          it.id === id ? { ...it, ...patch, updated_at: new Date().toISOString() } : it
        )
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(S2D_KEY, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: S2D_KEY }),
  });
}

export function useCreateS2DItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (item: Partial<S2DItem> & { title: string }) => {
      const sb = createSupabaseBrowserClient();
      const { error } = await sb.from("s2d_items").insert({
        title: item.title,
        description: item.description ?? null,
        status: item.status ?? "backlog",
        pathway: item.pathway ?? "heads_down",
        priority: item.priority ?? "medium",
        est_minutes: item.est_minutes ?? null,
        source_type: item.source_type ?? "manual",
        company_id: item.company_id ?? null,
      });
      if (error) throw error;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: S2D_KEY }),
  });
}
