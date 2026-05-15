"use client";

import { useQuery } from "@tanstack/react-query";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export interface InboxMessage {
  id: string;
  external_id: string;
  source: "gmail" | "slack";
  thread_id: string | null;
  channel: string | null;
  sender_name: string | null;
  sender_email: string | null;
  subject: string | null;
  preview: string | null;
  priority_score: number | null;
  priority_label: "urgent" | "action_required" | "fyi" | "low_priority" | "noise" | null;
  read: boolean;
  archived: boolean;
  received_at: string | null;
  company_id: string | null;
  s2d_item_id: string | null;
}

export function useInboxMessages() {
  return useQuery({
    queryKey: ["inbox-messages"],
    queryFn: async (): Promise<InboxMessage[]> => {
      const sb = createSupabaseBrowserClient();
      const { data, error } = await sb
        .from("messages")
        .select(
          "id, external_id, source, thread_id, channel, sender_name, sender_email, subject, preview, priority_score, priority_label, read, archived, received_at, company_id, s2d_item_id"
        )
        .eq("archived", false)
        .order("received_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as InboxMessage[];
    },
    staleTime: 30_000,
  });
}
