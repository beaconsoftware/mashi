"use client";

import { useQuery } from "@tanstack/react-query";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export interface LinearIssueRow {
  id: string;
  external_id: string;
  title: string;
  description: string | null;
  status: string;
  priority: number;
  assignee_name: string | null;
  assignee_email: string | null;
  labels: string[] | null;
  due_date: string | null;
  url: string | null;
  connected_account_id: string | null;
  company_id: string | null;
  updated_at: string;
}

export function useLinearIssues() {
  return useQuery({
    queryKey: ["linear-issues"],
    queryFn: async (): Promise<LinearIssueRow[]> => {
      const sb = createSupabaseBrowserClient();
      const { data, error } = await sb
        .from("linear_issues")
        .select(
          "id, external_id, title, description, status, priority, assignee_name, assignee_email, labels, due_date, url, connected_account_id, company_id, updated_at"
        )
        .order("updated_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as LinearIssueRow[];
    },
    staleTime: 60_000,
  });
}
