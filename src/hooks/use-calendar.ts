"use client";

import { useQuery } from "@tanstack/react-query";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export interface CalendarEventRow {
  id: string;
  external_id: string | null;
  title: string;
  description: string | null;
  start_at: string;
  end_at: string;
  attendees: Array<{
    email: string;
    name?: string | null;
    response?: string | null;
    organizer?: boolean;
    self?: boolean;
  }> | null;
  location: string | null;
  meeting_url: string | null;
  company_id: string | null;
}

export function useCalendarEvents() {
  return useQuery({
    queryKey: ["calendar-events"],
    queryFn: async (): Promise<CalendarEventRow[]> => {
      const sb = createSupabaseBrowserClient();
      const { data, error } = await sb
        .from("calendar_events")
        .select(
          "id, external_id, title, description, start_at, end_at, attendees, location, meeting_url, company_id"
        )
        .order("start_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as CalendarEventRow[];
    },
    staleTime: 30_000,
  });
}
