"use client";

import { useQuery } from "@tanstack/react-query";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export interface MeetingRow {
  id: string;
  external_id: string | null;
  title: string | null;
  date: string | null;
  duration_minutes: number | null;
  attendees: Array<{ email: string | null; name: string | null }> | null;
  summary: string | null;
  company_id: string | null;
  action_items_extracted: boolean;
}

export interface ActionItemRow {
  id: string;
  source_meeting_id: string | null;
  description: string;
  assignee: string | null;
  due_date: string | null;
  status: "pending" | "complete" | "cancelled" | "converted_to_s2d";
  company_id: string | null;
}

export function useMeetings() {
  return useQuery({
    queryKey: ["meetings"],
    queryFn: async (): Promise<MeetingRow[]> => {
      const sb = createSupabaseBrowserClient();
      const { data, error } = await sb
        .from("meetings")
        .select(
          "id, external_id, title, date, duration_minutes, attendees, summary, company_id, action_items_extracted"
        )
        .order("date", { ascending: false })
        .limit(300);
      if (error) throw error;
      return (data ?? []) as MeetingRow[];
    },
    staleTime: 60_000,
  });
}

export function useActionItemsForMeeting(meetingId: string | null) {
  return useQuery({
    queryKey: ["action-items", meetingId],
    enabled: meetingId != null,
    queryFn: async (): Promise<ActionItemRow[]> => {
      if (!meetingId) return [];
      const sb = createSupabaseBrowserClient();
      const { data, error } = await sb
        .from("action_items")
        .select("id, source_meeting_id, description, assignee, due_date, status, company_id")
        .eq("source_meeting_id", meetingId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ActionItemRow[];
    },
  });
}
